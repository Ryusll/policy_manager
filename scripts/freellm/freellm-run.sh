#!/bin/sh
# 규정 질문 무료 제공사 묶음(freellmapi) 컨테이너의 시작 스크립트 — VEDA T-208, ADR-0028.
# 이미지의 원래 시작(docker-entrypoint.sh → node 사용자로 서버)을 그대로 쓰고, 그 앞뒤에 VEDA 정책을 붙인다.
#  1) 제공사 키·관리자 계정을 환경변수에서 읽어 선언적 설정(FREEAPI_CONFIG_JSON)으로 넘긴다 — 값은 찍지 않는다
#  2) 지난 부팅의 통합 키 파일을 먼저 지운다 — 이번 부팅의 정책이 적용되기 전에는 api 가 부르지 못하게
#  3) 서버가 뜨면 freellm-init.mjs 가 허용 제공사 밖 키를 끄고(꺼졌는지 다시 확인) 통합 키를 공유 볼륨(/veda-shared)에 쓴다
#     — api 는 그 파일을 읽어 부른다(AI_QA_API_KEY_FILE). 실패하면 컨테이너를 내린다(배포·healthcheck 에서 보이게)
#  4) 10분마다 같은 정책을 다시 확인한다 — 실패하면 통합 키 파일을 지워 규정 질문을 멈춘다(고지 밖으로 새지 않게)
set -eu

FREEAPI_CONFIG_JSON="$(node /veda/freellm-config.mjs)"
export FREEAPI_CONFIG_JSON

mkdir -p /veda-shared
rm -f /veda-shared/unified-key /veda-shared/unified-key.tmp
chown node:node /veda-shared
chmod 700 /veda-shared

/usr/local/bin/docker-entrypoint.sh node server/dist/index.js &
PID=$!
trap 'kill -TERM "$PID" 2>/dev/null' TERM INT

run_init() { setpriv --reuid=node --regid=node --init-groups -- node /veda/freellm-init.mjs "$@"; }

if ! run_init; then
  echo "freellm-init: 실패 — 서버를 내린다(규정 질문은 쓸 수 없다, 위 로그를 확인한다)" >&2
  kill -TERM "$PID" 2>/dev/null || true
  wait "$PID" || true
  exit 1
fi

(
  while kill -0 "$PID" 2>/dev/null; do
    sleep 600
    kill -0 "$PID" 2>/dev/null || break
    if ! run_init --recheck; then
      rm -f /veda-shared/unified-key
      echo "freellm-init: 재점검 실패 — 통합 키를 지워 규정 질문을 멈췄다" >&2
    fi
  done
) &

wait "$PID"
