#!/usr/bin/env python3
"""Compose JSON을 stdin으로 받아 운영 필수값을 검사한다. 값은 출력하지 않는다."""
import json
import re
import sys
from urllib.parse import urlsplit


def main():
    config = json.load(sys.stdin)
    services = config["services"]
    env = services["api"]["environment"]
    db = services["postgres"]["environment"]
    errors = []
    url = urlsplit(env["PUBLIC_URL"])
    if (url.scheme != "https" or not url.hostname or url.username or url.password
            or url.path or url.query or url.fragment):
        errors.append("PUBLIC_URL은 경로 없는 HTTPS 주소여야 합니다.")
    for key in ("JWT_SECRET", "JWT_REFRESH_SECRET", "MINIO_SECRET_KEY"):
        if len(env[key]) < 32 or env[key].startswith('your-super-secret'):
            errors.append(f"{key}: 임의 생성된 32자 이상의 값이 필요합니다.")
    if env["JWT_SECRET"] == env["JWT_REFRESH_SECRET"]:
        errors.append("JWT 시크릿 두 개는 서로 달라야 합니다.")
    if not re.fullmatch(r"[a-zA-Z0-9_-]{32,}", db["POSTGRES_PASSWORD"]):
        errors.append("POSTGRES_PASSWORD: URL에 안전한 영문/숫자/_/- 32자 이상이 필요합니다.")
    for key in ("POSTGRES_USER", "POSTGRES_DB"):
        if not re.fullmatch(r"[a-zA-Z_][a-zA-Z0-9_]*", db[key]):
            errors.append(f"{key}: 영문/숫자/밑줄만 사용하세요.")
    if bool(env.get("GOOGLE_CLIENT_ID")) != bool(env.get("GOOGLE_CLIENT_SECRET")):
        errors.append("Google OAuth ID와 시크릿은 함께 설정하세요.")
    for key in ("SEED_DEMO_DATA", "ENABLE_SWAGGER", "ALLOW_LEGACY_BASELINE"):
        if env[key] != "false":
            errors.append(f"{key}는 false여야 합니다.")
    for name, service in services.items():
        for port in service.get("ports", []):
            if name != "web" or port.get("host_ip") != "127.0.0.1":
                errors.append(f"{name}: 허용하지 않은 외부 포트가 있습니다.")
    errors.extend(check_free_ai(services, env))
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print("운영 설정 검사 통과: HTTPS, 시크릿, 데모 비활성화, 내부 포트")
    return 0


def check_free_ai(services, api_env):
    """T-208 규정 질문 무료 제공사 묶음 — 켰으면 컨테이너(프로필 ai)·암호화 키·관리자 비밀번호·제공사 키·버전 고정이 있어야 한다."""
    if (api_env.get("AI_QA_PROVIDER") or "").strip().lower() != "freellmapi":
        return []
    free = services.get("freellmapi")
    if not free:
        return ["AI_QA_PROVIDER=freellmapi 인데 freellmapi 컨테이너가 없습니다(.env.oracle 에 COMPOSE_PROFILES=ai)."]
    env = free.get("environment") or {}
    errors = []
    if not re.fullmatch(r"[0-9a-fA-F]{64}", env.get("ENCRYPTION_KEY") or ""):
        errors.append("FREELLMAPI_ENCRYPTION_KEY: 64자리 16진수(openssl rand -hex 32)가 필요합니다.")
    if len(env.get("FREELLMAPI_ADMIN_PASSWORD") or "") < 16:
        errors.append("FREELLMAPI_ADMIN_PASSWORD: 임의 생성된 16자 이상이 필요합니다.")
    if not (env.get("FREELLMAPI_GOOGLE_KEY") or env.get("FREELLMAPI_GROQ_KEY")):
        errors.append("FREELLMAPI_GOOGLE_KEY·FREELLMAPI_GROQ_KEY 중 하나는 있어야 합니다.")
    if "@sha256:" not in (free.get("image") or ""):
        errors.append("freellmapi 이미지는 digest(@sha256:)로 고정해야 합니다.")
    models = [m.strip() for m in (api_env.get("AI_QA_MODELS") or "").split(",") if m.strip()]
    if any(re.match(r"(auto|fusion)(:|$)", m, re.I) for m in models):
        errors.append("AI_QA_MODELS 에 auto·fusion 은 쓸 수 없습니다(허용 목록 밖 모델까지 고릅니다).")
    platforms = [p.strip() for p in (api_env.get("AI_QA_ALLOWED_PLATFORMS") or "").split(",") if p.strip()]
    if any(p not in ("google", "groq") for p in platforms):
        errors.append("AI_QA_ALLOWED_PLATFORMS 는 고지 판 2 의 제공사(google, groq) 안에서만 고를 수 있습니다.")
    return errors


if __name__ == "__main__":
    sys.exit(main())
