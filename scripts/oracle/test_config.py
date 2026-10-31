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
