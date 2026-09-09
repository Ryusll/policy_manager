#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""규정 전문 HTML → HWPX. stdin으로 JSON, stdout으로 HWPX(ZIP) 바이트.

**HWPX 를 만드는 이유는 .hwp 를 만들 수 없어서다.** .hwp 는 한컴의 독점 바이너리
(CFBF 컨테이너 + 압축 레코드)라서 리눅스 컨테이너에서 생성할 공개 수단이 없다.
HWPX 는 같은 한/글이 여는 KS X 6101(OWPML) 표준이고 ZIP+XML 이라 만들 수 있다.
자세한 판단 근거는 ADR-0016.

OWPML 의 header.xml 에는 글꼴·문단·글자 모양 표가 들어가고 본문은 그 표를 ID 로
참조한다. 이 표를 손으로 쓰면 조용히 어긋나 한/글이 파일을 거부하므로,
`pyhwpxlib`(순수 파이썬, 한컴 오피스 불필요)가 만든 골격을 그대로 쓴다.

입력 JSON: {"html": "...", "title": "..."}
출력: 성공 시 stdout=HWPX 바이트, 실패 시 exit!=0 + stderr 메시지
"""
import io
import json
import os
import sys
import tempfile


def fail(message: str) -> None:
    sys.stderr.write(message + "\n")
    sys.exit(1)


def main() -> None:
    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError as e:
        fail(f"입력 JSON을 읽지 못했습니다: {e}")

    html = str(payload.get("html") or "").strip()
    if not html:
        fail("출력할 본문이 없습니다.")

    title = str(payload.get("title") or "").strip()

    try:
        from pyhwpxlib import api
        from pyhwpxlib.html_to_hwpx import convert_html_to_hwpx
    except ImportError as e:
        fail(f"HWPX 라이브러리를 불러오지 못했습니다: {e}")

    # 제목은 본문 HTML 에도 들어 있지만, 문서를 열었을 때 첫 줄이 제목이어야
    # 목록에서 파일을 구분할 수 있다. 중복이면 변환기가 같은 문단을 두 번 만들지
    # 않도록 HTML 쪽에 제목이 이미 있는지 보고 넣는다.
    body = html
    if title and f">{title}<" not in html:
        body = f"<h1>{title}</h1>\n{html}"

    try:
        doc = api.create_document()
        convert_html_to_hwpx(doc, body)
    except Exception as e:  # noqa: BLE001 - 변환기 내부 예외를 그대로 사용자에게 전달
        fail(f"HWPX 변환에 실패했습니다: {e}")

    # 라이브러리가 경로 저장만 지원한다. 임시 파일로 받아 stdout 으로 흘린다.
    tmp_path = None
    try:
        fd, tmp_path = tempfile.mkstemp(suffix=".hwpx")
        os.close(fd)
        api.save(doc, tmp_path)
        with open(tmp_path, "rb") as f:
            data = f.read()
    except Exception as e:  # noqa: BLE001
        fail(f"HWPX 저장에 실패했습니다: {e}")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    if not data:
        fail("HWPX 산출물이 비어 있습니다.")

    out = getattr(sys.stdout, "buffer", sys.stdout)
    out.write(data)
    out.flush()


if __name__ == "__main__":
    main()
