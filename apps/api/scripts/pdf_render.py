#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""규정 전문 HTML → PDF (PyMuPDF Story). stdin으로 JSON, stdout으로 PDF 바이트.

한글 폰트는 PyMuPDF wheel에 동봉된 CJK 폰트(Droid Sans Fallback)를 그대로 쓴다.
컨테이너에 별도 폰트를 설치하지 않아도 되고, 텍스트가 이미지가 아니라 실제 문자로
남아서 검색·복사가 된다. 저장 직전 subset_fonts()로 임베드 용량을 줄인다
(전체 CJK 임베드 약 3.5MB → 실제 사용 글자만 남기면 수십 KB).

입력 JSON: {"html": "...", "title": "...", "footerText": "...", "pageNumbers": true}
출력: 성공 시 stdout=PDF 바이트, 실패 시 exit!=0 + stderr 메시지
"""
import io
import json
import sys

# PyMuPDF는 1.24.3에서 주 모듈명을 fitz → pymupdf 로 바꿨다(fitz는 별칭으로 유지).
# requirements.txt가 >=1.24.0 이라 두 이름 모두 나올 수 있어 양쪽을 받아준다.
try:
    import pymupdf as fitz
except ImportError:  # PyMuPDF < 1.24.3
    import fitz


def build_css(font_name: str) -> str:
    return f"""
@font-face {{ font-family: doc; src: url({font_name}); }}
* {{ font-family: doc; }}
body {{ font-size: 10pt; line-height: 1.5; color: #111827; }}
h1 {{ font-size: 17pt; margin-bottom: 2pt; }}
h2 {{ font-size: 12.5pt; margin-top: 12pt; margin-bottom: 4pt; }}
h3 {{ font-size: 11pt; margin-top: 8pt; margin-bottom: 3pt; }}
p {{ margin: 0 0 4pt 0; }}
.doc-meta {{ font-size: 8.5pt; color: #6b7280; margin-bottom: 10pt; }}
.tmpl-chapter-title {{ font-size: 12.5pt; }}
.tmpl-section-title {{ font-size: 11pt; }}
.tmpl-article-label {{ font-size: 10.5pt; margin-top: 7pt; }}
.tmpl-article-name {{ font-size: 10pt; }}
.tmpl-article-body {{ margin: 1pt 0 3pt 0; }}
.tmpl-row-hang {{ margin-left: 14pt; }}
.tmpl-row-item {{ margin-left: 28pt; }}
.tmpl-empty {{ color: #6b7280; }}
.doc-footer {{ font-size: 8pt; color: #6b7280; margin-top: 14pt; }}
"""


def render(payload: dict) -> bytes:
    html = payload.get("html") or ""
    title = payload.get("title") or ""
    footer_text = (payload.get("footerText") or "").strip()
    page_numbers = bool(payload.get("pageNumbers"))

    font = fitz.Font("korea")
    archive = fitz.Archive()
    archive.add(font.buffer, "docfont.ttf")

    head = ""
    if title:
        head += f"<h1>{title}</h1>"
    meta = (payload.get("metaLine") or "").strip()
    if meta:
        head += f'<p class="doc-meta">{meta}</p>'
    body = head + html
    if footer_text:
        body += f'<p class="doc-footer">{footer_text}</p>'

    story = fitz.Story(html=body, user_css=build_css("docfont.ttf"), archive=archive)

    stream = io.BytesIO()
    writer = fitz.DocumentWriter(stream)
    mediabox = fitz.paper_rect("a4")
    # 여백: 상 20mm / 하 18mm / 좌우 18mm (mm → pt = ×2.8346)
    where = mediabox + (51, 57, -51, -51)

    more = 1
    page_count = 0
    while more:
        device = writer.begin_page(mediabox)
        more, _ = story.place(where)
        story.draw(device)
        writer.end_page()
        page_count += 1
        if page_count > 2000:
            raise RuntimeError("페이지 수가 비정상적으로 많습니다(무한 루프 방지).")
    writer.close()

    doc = fitz.open("pdf", stream.getvalue())

    if page_numbers:
        total = doc.page_count
        for i, page in enumerate(doc):
            # ASCII만 쓰므로 내장 base-14 폰트로 충분하다(폰트 추가 임베드 없음)
            page.insert_text(
                fitz.Point(mediabox.width / 2 - 18, mediabox.height - 28),
                f"- {i + 1} / {total} -",
                fontname="helv",
                fontsize=8,
                color=(0.42, 0.45, 0.5),
            )

    # 실제 쓰인 글자만 임베드 (CJK 전체 폰트가 그대로 들어가면 수 MB가 된다)
    try:
        doc.subset_fonts(verbose=False)
    except Exception:
        pass

    out = doc.tobytes(garbage=4, deflate=True)
    doc.close()
    return out


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError as exc:
        sys.stderr.write(f"입력 JSON 파싱 실패: {exc}\n")
        return 2

    try:
        data = render(payload)
    except Exception as exc:  # noqa: BLE001 - 원인을 그대로 노출해야 진단이 된다
        sys.stderr.write(f"PDF 생성 실패: {type(exc).__name__}: {exc}\n")
        return 1

    out = sys.stdout.buffer
    out.write(data)
    out.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
