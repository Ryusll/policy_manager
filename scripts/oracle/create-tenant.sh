#!/usr/bin/env bash
# 고객사 개설 + 마스터 계정 발급 (T-122). 평소에는 통합 관리자 콘솔에서 한다.
# 이 스크립트는 **새 서버의 첫 플랫폼 관리자**(아스트룸 운영자)를 만들 때 쓴다 — 공개 회원가입이
# 닫혀 있어 화면으로는 첫 계정을 만들 수 없다.
#
#   bash scripts/oracle/create-tenant.sh <조직코드> <회사명> <마스터이메일> <마스터이름> [--platform-admin] [--plan starter|pro|enterprise]
#
# 임시 비밀번호는 실행 결과에 한 번만 나온다. 마스터는 처음 로그인할 때 바꿔야 한다.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USAGE='사용법: bash scripts/oracle/create-tenant.sh <조직코드> <회사명> <마스터이메일> <마스터이름> [--platform-admin] [--plan starter|pro|enterprise]'
SLUG="${1:?$USAGE}"; NAME="${2:?$USAGE}"; EMAIL="${3:?$USAGE}"; MASTER="${4:?$USAGE}"
shift 4
PLATFORM=false; PLAN=starter
while [ $# -gt 0 ]; do
  case "$1" in
    --platform-admin) PLATFORM=true ;;
    --plan) PLAN="${2:?$USAGE}"; shift ;;
    *) echo "$USAGE" >&2; exit 1 ;;
  esac
  shift
done
# 값은 JSON 으로 stdin 에 넘긴다 — 명령줄 인자로 넘기면 따옴표·공백이 깨지기 쉽다
python3 -c 'import json,sys; print(json.dumps({"slug":sys.argv[1],"name":sys.argv[2],"masterEmail":sys.argv[3],"masterName":sys.argv[4],"platformAdmin":sys.argv[5]=="true","plan":sys.argv[6]}, ensure_ascii=False))' \
  "$SLUG" "$NAME" "$EMAIL" "$MASTER" "$PLATFORM" "$PLAN" \
  | bash "$SCRIPT_DIR/compose.sh" exec -T api node dist/platform-admin/provision.cli.js
