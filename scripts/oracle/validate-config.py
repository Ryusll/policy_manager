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
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print("운영 설정 검사 통과: HTTPS, 시크릿, 데모 비활성화, 내부 포트")
    return 0


if __name__ == "__main__":
    sys.exit(main())
