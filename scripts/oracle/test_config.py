import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / 'scripts/oracle'


class OracleConfigTest(unittest.TestCase):
    def setUp(self):
        self.work = tempfile.TemporaryDirectory()
        self.addCleanup(self.work.cleanup)
        self.env_file = Path(self.work.name) / 'oracle.env'
        self.run_init('https://veda.example.com')

    def run_init(self, url):
        return subprocess.run(['python3', str(SCRIPTS / 'init-env.py'), url, '--output', str(self.env_file)],
                              capture_output=True, text=True)

    def config(self):
        env = dict(os.environ, ORACLE_ENV_FILE=str(self.env_file), ORACLE_PROJECT_NAME='oracle-config-test')
        result = subprocess.run(['bash', str(SCRIPTS / 'compose.sh'), 'config', '--format', 'json'],
                                env=env, capture_output=True, text=True, check=True)
        return json.loads(result.stdout)

    def validate(self, config):
        return subprocess.run(['python3', str(SCRIPTS / 'validate-config.py')],
                              input=json.dumps(config), capture_output=True, text=True)

    def test_secrets_are_private_and_not_overwritten(self):
        content = self.env_file.read_text()
        self.assertEqual(self.env_file.stat().st_mode & 0o777, 0o600)
        self.assertNotEqual(self.run_init('https://another.example.com').returncode, 0)
        self.assertEqual(self.env_file.read_text(), content)
        values = dict(line.split('=', 1) for line in content.splitlines() if line and not line.startswith('#'))
        self.assertNotEqual(values['JWT_SECRET'], values['JWT_REFRESH_SECRET'])
        self.assertRegex(values['POSTGRES_PASSWORD'], r'^[a-f0-9]{64}$')

    def test_invalid_url_creates_no_file(self):
        self.env_file.unlink()
        for url in ['http://example.com', 'https://user:pw@example.com', 'https://example.com/api',
                    'https://example.com\nJWT_SECRET=injected', 'https://example.com?x=1']:
            self.assertNotEqual(self.run_init(url).returncode, 0)
            self.assertFalse(self.env_file.exists())

    def test_production_ports_secrets_and_flags(self):
        config = self.config()
        self.assertEqual(self.validate(config).returncode, 0)
        services = config['services']
        for name in ['postgres', 'redis', 'api']:
            self.assertFalse(services[name].get('ports'))
        self.assertEqual(len(services['web']['ports']), 1)
        self.assertEqual(services['web']['ports'][0]['host_ip'], '127.0.0.1')
        env = services['api']['environment']
        self.assertEqual(env['PUBLIC_URL'], 'https://veda.example.com')
        self.assertEqual(env['CORS_ORIGIN'], env['PUBLIC_URL'])
        for key in ['SEED_DEMO_DATA', 'ALLOW_LEGACY_BASELINE', 'ENABLE_SWAGGER']:
            self.assertEqual(env[key], 'false')

    def with_free_ai(self, extra):
        """T-208 무료 제공사 묶음을 켠 운영 env — 프로필 ai 로 freellmapi 컨테이너가 붙는다"""
        with open(self.env_file, 'a', encoding='utf-8') as f:
            f.write('COMPOSE_PROFILES=ai\nAI_QA_PROVIDER=freellmapi\n' + extra)
        return self.config()

    def test_free_ai_off_by_default_and_internal_only(self):
        """T-208 기본은 꺼져 있고(컨테이너 없음), 켜면 호스트 포트 없이 digest 고정 이미지로 뜬다"""
        self.assertNotIn('freellmapi', self.config()['services'])
        config = self.with_free_ai(
            'FREELLMAPI_ENCRYPTION_KEY=' + '0' * 64 + '\nFREELLMAPI_ADMIN_PASSWORD=' + 'p' * 24 + '\nFREELLMAPI_GOOGLE_KEY=AIza-test\n')
        self.assertEqual(self.validate(config).returncode, 0)
        free = config['services']['freellmapi']
        self.assertFalse(free.get('ports'))
        self.assertIn('@sha256:', free['image'])
        self.assertEqual(config['services']['api']['environment']['AI_QA_PROVIDER'], 'freellmapi')

    def test_free_ai_without_keys_or_container_is_rejected(self):
        """T-208 켰는데 암호화 키·관리자 비밀번호·제공사 키가 없거나 컨테이너가 없으면 배포를 막는다(값은 찍지 않는다)"""
        config = self.with_free_ai('FREELLMAPI_ADMIN_PASSWORD=short\n')
        result = self.validate(config)
        self.assertNotEqual(result.returncode, 0)
        for key in ['FREELLMAPI_ENCRYPTION_KEY', 'FREELLMAPI_ADMIN_PASSWORD', 'FREELLMAPI_GROQ_KEY']:
            self.assertIn(key, result.stderr)
        self.assertNotIn('short', result.stderr)
        del config['services']['freellmapi']
        self.assertIn('COMPOSE_PROFILES=ai', self.validate(config).stderr)

    def test_free_ai_rejects_auto_models_and_platforms_outside_notice(self):
        """T-208 auto·fusion 모델과 고지 판 2 밖 제공사(google·groq 밖)는 배포를 막는다"""
        config = self.with_free_ai(
            'FREELLMAPI_ENCRYPTION_KEY=' + '0' * 64 + '\nFREELLMAPI_ADMIN_PASSWORD=' + 'p' * 24
            + '\nFREELLMAPI_GOOGLE_KEY=AIza-test\nAI_QA_MODELS=gemini-3.8-flash,auto\nAI_QA_ALLOWED_PLATFORMS=google,kilo\n')
        result = self.validate(config)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('AI_QA_MODELS', result.stderr)
        self.assertIn('AI_QA_ALLOWED_PLATFORMS', result.stderr)

    def test_free_ai_env_editor_is_idempotent_and_quiet(self):
        """T-208 서버 env 편집기 — 값은 찍지 않고, 백업을 남기고, 암호화 키·관리자 비밀번호는 다시 돌려도 바꾸지 않는다"""
        env = dict(os.environ, ORACLE_ENV_FILE=str(self.env_file))
        run = lambda stdin: subprocess.run(['python3', str(SCRIPTS / 'ai-free-env.py')], input=stdin,
                                           env=env, capture_output=True, text=True)
        first = run('AIza-secret-google\n\n')
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertNotIn('AIza-secret-google', first.stdout + first.stderr)
        text = self.env_file.read_text()
        self.assertIn('AI_QA_PROVIDER=freellmapi', text)
        self.assertIn('COMPOSE_PROFILES=ai', text)
        self.assertIn('FREELLMAPI_GOOGLE_KEY=AIza-secret-google', text)
        self.assertEqual(self.env_file.stat().st_mode & 0o777, 0o600)
        enc = [l for l in text.splitlines() if l.startswith('FREELLMAPI_ENCRYPTION_KEY=')]
        second = run('\ngsk-secret-groq\n')
        self.assertEqual(second.returncode, 0, second.stderr)
        text2 = self.env_file.read_text()
        self.assertEqual([l for l in text2.splitlines() if l.startswith('FREELLMAPI_ENCRYPTION_KEY=')], enc)
        self.assertIn('FREELLMAPI_GOOGLE_KEY=AIza-secret-google', text2)
        self.assertIn('FREELLMAPI_GROQ_KEY=gsk-secret-groq', text2)
        self.assertEqual(len([l for l in text2.splitlines() if l.startswith('COMPOSE_PROFILES=')]), 1)
        self.assertEqual(len(list(self.env_file.parent.glob('oracle.env.bak-*'))) >= 1, True)
        self.assertEqual(self.validate(self.config()).returncode, 0)

    def test_free_ai_env_editor_refuses_without_keys(self):
        """T-208 제공사 키가 하나도 없으면 아무것도 바꾸지 않는다"""
        before = self.env_file.read_text()
        result = subprocess.run(['python3', str(SCRIPTS / 'ai-free-env.py')], input='\n\n',
                                env=dict(os.environ, ORACLE_ENV_FILE=str(self.env_file)), capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.env_file.read_text(), before)

    def test_weak_secrets_and_public_database_are_rejected(self):
        config = self.config()
        config['services']['api']['environment']['JWT_SECRET'] = 'short'
        config['services']['postgres']['ports'] = [{'host_ip': '0.0.0.0', 'target': 5432}]
        self.assertNotEqual(self.validate(config).returncode, 0)

    def test_migration_failure_never_baselines_or_seeds_in_oracle(self):
        work = Path(self.work.name)
        log = work / 'commands'
        for name, body in [('sleep', 'exit 0'), ('npx', 'echo "$*" >> "$TEST_COMMAND_LOG"; exit 1')]:
            script = work / name
            script.write_text('#!/bin/sh\n' + body + '\n')
            script.chmod(0o700)
        env = dict(os.environ, PATH=str(work) + os.pathsep + os.environ['PATH'],
                   ALLOW_LEGACY_BASELINE='false', SEED_DEMO_DATA='false', TEST_COMMAND_LOG=str(log))
        result = subprocess.run(['sh', str(ROOT / 'apps/api/docker-entrypoint.sh')], env=env,
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(log.read_text().splitlines(), ['prisma migrate deploy'])


if __name__ == '__main__':
    unittest.main()
