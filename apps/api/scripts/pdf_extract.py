#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""사내 규정 PDF: pdfplumber 우선, 실패 시 PyMuPDF(fitz) fallback. stdout에 JSON UTF-8."""
import json
import sys


def lines_from_page_text(text: str, page_num: int):
    out = []
    for ln in (text or "").replace("\r\n", "\n").split("\n"):
        out.append({"text": ln, "page": page_num, "font_size": None, "font_name": None, "bold": None})
    return out


def extract_pdfplumber(path: str):
    import pdfplumber

    full_parts = []
    lines_out = []
    with pdfplumber.open(path) as pdf:
        for pi, page in enumerate(pdf.pages):
            text = page.extract_text() or ""
            full_parts.append(text)
            words = page.extract_words(extra_attrs=["size", "fontname"]) or []
            if words:
                rows = {}
                for w in words:
                    y = round(float(w.get("top", 0)) / 3) * 3
                    rows.setdefault(y, []).append(w)
                for y in sorted(rows.keys()):
                    row_words = sorted(rows[y], key=lambda x: float(x.get("x0", 0)))
                    line_text = " ".join((x.get("text") or "") for x in row_words).strip()
                    if not line_text:
                        continue
                    sizes = [float(x.get("size") or 0) for x in row_words if x.get("size")]
                    names = [str(x.get("fontname") or "") for x in row_words]
                    fs = sum(sizes) / len(sizes) if sizes else None
                    fn = names[0] if names else None
                    bold = any("Bold" in n or "bold" in n for n in names)
                    lines_out.append(
                        {
                            "text": line_text,
                            "page": pi + 1,
                            "font_size": fs,
                            "font_name": fn,
                            "bold": bold,
                        }
                    )
            else:
                lines_out.extend(lines_from_page_text(text, pi + 1))
    return "\n".join(full_parts), lines_out


def extract_pymupdf(path: str):
    import fitz

    full_parts = []
    lines_out = []
    doc = fitz.open(path)
    try:
        for pi in range(len(doc)):
            page = doc[pi]
            text = page.get_text("text") or ""
            full_parts.append(text)
            lines_out.extend(lines_from_page_text(text, pi + 1))
    finally:
        doc.close()
    return "\n".join(full_parts), lines_out


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "usage: pdf_extract.py <path>"}))
        sys.exit(2)
    path = sys.argv[1]
    err_pb = None
    try:
        full_text, lines = extract_pdfplumber(path)
        print(json.dumps({"ok": True, "engine": "pdfplumber", "full_text": full_text, "lines": lines}, ensure_ascii=False))
        return
    except Exception as e:
        err_pb = str(e)
    try:
        full_text, lines = extract_pymupdf(path)
        print(json.dumps({"ok": True, "engine": "pymupdf", "full_text": full_text, "lines": lines, "fallback_from": err_pb}, ensure_ascii=False))
        return
    except Exception as e2:
        print(json.dumps({"ok": False, "error": err_pb, "fallback_error": str(e2)}, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
