#!/usr/bin/env python3
"""운영 환경 파일을 한 번만 생성한다. 기존 비밀번호/개발 .env는 변경하지 않는다."""
import argparse
import os
from pathlib import Path
import re
import secrets
from urllib.parse import urlsplit


def main():
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("public_url", help="실제 브라우저 HTTPS 주소")
    parser.add_argument("--output", type=Path, default=root / ".env.oracle")
    args = parser.parse_args()
    url = args.public_url.rstrip("/")
    parts = urlsplit(url)
    if (parts.scheme != "https" or not parts.hostname or parts.username or parts.password
            or parts.path or parts.query or parts.fragment
            or not re.fullmatch(r"https://[a-zA-Z0-9.-]+(?::[0-9]+)?", url)):
        parser.error("경로/쿼리/인증정보 없이 https://호스트 형태로 입력하세요.")
    values = {"PUBLIC_URL": url}
    for key in ("POSTGRES_PASSWORD", "JWT_SECRET", "JWT_REFRESH_SECRET", "MINIO_SECRET_KEY"):
        values[key] = secrets.token_hex(32)
    template = (root / ".env.oracle.example").read_text()
    for key, value in values.items():
        template = re.sub(rf"^{key}=.*$", f"{key}={value}", template, flags=re.MULTILINE)
    try:
        fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        parser.error(f"{args.output} 파일이 이미 있습니다. 기존 시크릿을 유지합니다.")
    with os.fdopen(fd, "w") as out:
        out.write(template)
    print(f"생성 완료: {args.output} (권한 600, 시크릿 값은 출력하지 않음)")


if __name__ == "__main__":
    main()
