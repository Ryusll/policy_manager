#!/usr/bin/env python3
"""규정 질문 무료 제공사 묶음(freellmapi, T-208)을 켤 값을 .env.oracle 에 넣는다. 서버에서 돈다. 값은 출력하지 않는다.

표준 입력 두 줄: Google AI Studio 키, Groq 키 — 빈 줄이면 그 제공사는 바꾸지 않는다(이미 있는 값을 둔다).
- COMPOSE_PROFILES 에 ai 를 더하고 AI_QA_PROVIDER=freellmapi 로 둔다
- FREELLMAPI_ENCRYPTION_KEY·FREELLMAPI_ADMIN_PASSWORD 는 형식에 맞는 값이 없을 때만 새로 만든다
  (암호화 키를 바꾸면 freellmapi 에 저장된 제공사 키를 못 읽고, 관리자 계정은 첫 기동 때만 만들어진다)
- 고치기 전 파일을 .env.oracle.bak-<시각> 으로 남긴다(되돌리기 — 런북 7-9-1)
"""
import os
from pathlib import Path
import re
import secrets
import sys
import time

ENV = Path(os.environ.get("ORACLE_ENV_FILE") or Path(__file__).resolve().parents[2] / ".env.oracle")


def current(lines, key):
    value = ""
    for line in lines:
        if line.startswith(f"{key}="):
            value = line[len(key) + 1:].strip().strip("'\"")
    return value


def put(lines, key, value):
    out = [line for line in lines if not line.startswith(f"{key}=")]
    out.append(f"{key}={value}")
    return out


def main():
    if not ENV.exists():
        print(f"{ENV.name} 이 없습니다 — 서버의 ~/policy_manager 에서 실행하세요", file=sys.stderr)
        return 1
    given = (sys.stdin.read().split("\n") + ["", ""])[:2]
    google, groq = (v.strip() for v in given)
    text = ENV.read_text(encoding="utf-8")
    lines = text.rstrip("\n").split("\n") if text.strip() else []
    if not (google or groq or current(lines, "FREELLMAPI_GOOGLE_KEY") or current(lines, "FREELLMAPI_GROQ_KEY")):
        print("Google·Groq 키가 둘 다 없습니다 — Mac .env 에 넣고 다시 실행하세요", file=sys.stderr)
        return 1

    # 같은 초에 다시 돌려도 앞 백업을 덮지 않게 임의 접미사를 붙인다
    backup = ENV.with_name(f"{ENV.name}.bak-{time.strftime('%Y%m%d%H%M%S')}-{secrets.token_hex(2)}")
    fd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(text)

    notes = []
    profiles = [p for p in current(lines, "COMPOSE_PROFILES").split(",") if p.strip()]
    if "ai" not in profiles:
        profiles.append("ai")
    lines = put(lines, "COMPOSE_PROFILES", ",".join(profiles))
    lines = put(lines, "AI_QA_PROVIDER", "freellmapi")
    if not re.fullmatch(r"[0-9a-fA-F]{64}", current(lines, "FREELLMAPI_ENCRYPTION_KEY")):
        lines = put(lines, "FREELLMAPI_ENCRYPTION_KEY", secrets.token_hex(32))
        notes.append("암호화 키 새로 만듦")
    if len(current(lines, "FREELLMAPI_ADMIN_PASSWORD")) < 16:
        lines = put(lines, "FREELLMAPI_ADMIN_PASSWORD", secrets.token_hex(16))
        notes.append("관리자 비밀번호 새로 만듦")
    if google:
        lines = put(lines, "FREELLMAPI_GOOGLE_KEY", google)
        notes.append("Google 키 넣음")
    if groq:
        lines = put(lines, "FREELLMAPI_GROQ_KEY", groq)
        notes.append("Groq 키 넣음")

    tmp = ENV.with_name(f".{ENV.name}.tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    os.replace(tmp, ENV)
    print(f"[ai-free-env] {ENV.name} 갱신: COMPOSE_PROFILES 에 ai, AI_QA_PROVIDER=freellmapi"
          + (", " + ", ".join(notes) if notes else "") + f" · 이전 파일 {backup.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
