export type ImportRefineOptions = {
  collapseSpaces: boolean;
  trimLines: boolean;
  removeFormCoverLines: boolean;
  unifyQuotes: boolean;
};

export const defaultImportRefineOptions = (): ImportRefineOptions => ({
  collapseSpaces: true,
  trimLines: true,
  removeFormCoverLines: true,
  unifyQuotes: false,
});

/** 가져오기 원문 텍스트 정제 (PDF 복사 노이즈 완화) */
export function refineImportRawText(input: string, opts: ImportRefineOptions): string {
  let s = String(input || '');

  if (opts.removeFormCoverLines) {
    s = s
      .split('\n')
      .filter((line) => {
        const t = line.trim();
        if (!t) return true;
        if (/문서번호/.test(t) && (/\d\s*\/\s*\d+/.test(t) || /쪽\s*수/i.test(t))) return false;
        return true;
      })
      .join('\n');
  }

  if (opts.trimLines) {
    s = s
      .split('\n')
      .map((l) => l.trimEnd())
      .join('\n');
  }

  if (opts.collapseSpaces) {
    s = s.replace(/[ \t\f\v]+/g, ' ').replace(/ *\n */g, '\n');
  }

  if (opts.unifyQuotes) {
    s = s.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
  }

  return s.replace(/\n{4,}/g, '\n\n\n').trim();
}
