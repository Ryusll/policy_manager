type ParsedArticle = {
  number: number;
  title: string;
  content: string;
};

type ParsedChapter = {
  number: number;
  title: string;
  articles: ParsedArticle[];
  /** 원문에 장 표기가 없어 파서가 임의로 만든 장. 등록 시 숨김 장으로 처리한다 */
  auto?: boolean;
};

export type ParsedPolicyDraft = {
  chapters: ParsedChapter[];
};

export type ParseProfile = 'mixed' | 'korean' | 'english';

const MIN_FALLBACK_CHARS = 12;

/** 유니코드 로마 숫자(Ⅰ…) → ASCII(IX…) */
function normalizeUnicodeRomanPrefix(line: string): string {
  let out = line;
  const pairs: [string, string][] = [
    ['\u216B', 'XII'],
    ['\u216A', 'XI'],
    ['\u2169', 'X'],
    ['\u2168', 'IX'],
    ['\u2167', 'VIII'],
    ['\u2166', 'VII'],
    ['\u2165', 'VI'],
    ['\u2164', 'V'],
    ['\u2163', 'IV'],
    ['\u2162', 'III'],
    ['\u2161', 'II'],
    ['\u2160', 'I'],
  ];
  for (const [u, a] of pairs) {
    out = out.split(u).join(a);
  }
  return out;
}

/** PDF 양식에서 페이지마다 반복되는 머릿글(문서번호·쪽수 등) */
function stripFormCoverLines(text: string): string {
  return text
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      if (!t) return true;
      if (/문서번호/.test(t) && (/\d\s*\/\s*\d+/.test(t) || /쪽\s*수/i.test(t))) return false;
      return true;
    })
    .join('\n');
}

/** PDF 등에서 줄바꿈 없이 이어지거나 전각 숫자가 쓰인 경우를 완화 */
function preprocessPolicyImportText(input: string): string {
  let s = String(input || '')
    .replace(/\r\n/g, '\n')
    .replace(/\uFEFF/g, '');
  s = s.replace(/[\uFF10-\uFF19]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30));
  s = s.replace(/\u3000/g, ' ');
  s = stripFormCoverLines(s);

  // 한 줄에 "…제2장 … 제1조 …"처럼 붙는 경우
  const beforeChapter = /([^\n])(?=\s*제\s*[0-9IVXLCDMivxlcdm]+\s*장(?:\s|[.:：\-（(]|$))/gi;
  const beforeArticle = /([^\n])(?=\s*제\s*[0-9IVXLCDMivxlcdm]+\s*조(?:\s|[.:：\-（(]|$))/gi;
  s = s.replace(beforeChapter, '$1\n');
  s = s.replace(beforeArticle, '$1\n');

  // "…Ⅱ . 정보보안 …" / "…I 총칙 …" 로마 장 표기
  s = s.replace(/([^\n])(?=\s*(?:[IVXLCDM]{1,6}|[\u2160-\u216B]+)(?:\s*[.．])?\s+[가-힣A-Za-z])/gi, '$1\n');

  // "총 칙 1 . 목 적" 처럼 장 제목 뒤에 조항이 붙은 경우
  s = s.replace(/([가-힣])(?=\s+\d{1,2}(?:\s*[.．]\s*\d+){0,4}(?:\s*[.．])?\s+[가-힣ㄱ-ㅎA-Za-z])/g, '$1\n');

  // "…문 4.1 / 7.2.1 …" 십진 항이 문장 중간에 붙은 경우 줄 분리
  s = s.replace(
    /([^\n가-힣\s])(?=\s*\d{1,2}(?:\s*[.．]\s*\d+){1,4}(?:\s*[.．])?\s+[가-힣ㄱ-ㅎA-Za-z])/g,
    '$1\n',
  );

  return s;
}

function romanToInt(input: string): number | null {
  const s = input.toUpperCase().trim();
  if (!/^[IVXLCDM]+$/.test(s)) return null;
  const map: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let total = 0;
  for (let i = 0; i < s.length; i += 1) {
    const cur = map[s[i]];
    const next = map[s[i + 1]] || 0;
    total += cur < next ? -cur : cur;
  }
  return total > 0 ? total : null;
}

function alphaToInt(input: string): number | null {
  const s = input.trim().toUpperCase();
  if (!/^[A-Z]$/.test(s)) return null;
  return s.charCodeAt(0) - 64;
}

function tokenToInt(token: string): number | null {
  const t = token.trim();
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t);
  const roman = romanToInt(t);
  if (roman) return roman;
  const alpha = alphaToInt(t);
  if (alpha) return alpha;
  return null;
}

/**
 * 목차 번호만 제거 (예: "1. 제1조") — 십진 조항 "1. 목적"은 제거하지 않음.
 */
function stripEnumeratePrefix(line: string): string {
  let s = line.trim().replace(/^[\s\u200b\u200c]+/, '');
  for (let i = 0; i < 4; i += 1) {
    const candidate = s
      .replace(/^\(?[0-9]+\)?[.)、:：\]]\s*/u, '')
      .replace(/^[（(]\s*[0-9]+\s*[）)]\s*/u, '')
      .replace(/^【\s*[0-9]+\s*】\s*/u, '')
      .trim();
    if (candidate === s) break;
    const t = candidate.trim();
    if (!/^제\s*\S|^chapter\b/i.test(t)) break;
    s = candidate;
  }
  return s;
}

function parseRomanChapterLine(s: string): { num: number | null; title: string } | null {
  const romanNorm = normalizeUnicodeRomanPrefix(s);
  const rm = romanNorm.match(/^([IVXLCDM]+)(?:\s*[.．])?\s+(.*)$/i);
  if (!rm) return null;
  const num = romanToInt(rm[1].toUpperCase());
  if (num === null || num < 1 || num > 99) return null;
  const title = (rm[2] || '').replace(/\s+/g, ' ').trim();
  return { num, title: title || `제${num}장` };
}

function parseChapterHeader(line: string, profile: ParseProfile): { num: number | null; title: string } | null {
  const s = stripEnumeratePrefix(line);

  const romanCh = parseRomanChapterLine(s);
  if (romanCh) return romanCh;

  if (profile !== 'english') {
    const m1 = s.match(/^제\s*([0-9IVXLCDMivxlcdm]+)\s*장[\s.)-]*(.*)$/);
    if (m1) return { num: tokenToInt(m1[1]), title: (m1[2] || '').trim() || '총칙' };
  }

  if (profile !== 'korean') {
    const m2 = s.match(/^(chapter|chap\.?)\s*([A-Z]|\d+|[IVXLCDMivxlcdm]+)[\s:.)-]*(.*)$/i);
    if (m2) return { num: tokenToInt(m2[2]), title: (m2[3] || '').trim() || `${m2[1]} ${m2[2]}` };
  }

  const m3 = s.match(/^([A-Z]|\d+|[IVXLCDMivxlcdm]+)\s*[.)-]\s*(.*)$/);
  if (m3 && /(장|chapter|chap)/i.test(s) && profile === 'mixed') {
    return { num: tokenToInt(m3[1]), title: (m3[2] || '').trim() || '총칙' };
  }
  return null;
}

/** "1. 목적", "2.1 본 지침은 …", "1. Purpose" 등 회사 지침·규정 흔한 십진 목차 */
function parseDecimalOutlineArticleHeader(line: string, _profile: ParseProfile): { num: number | null; title: string } | null {
  const t0 = line.trim().replace(/\s*[.．]\s*/g, '.');
  const dec = t0.match(/^(\d+(?:\.\d+){0,4})(?:\.)?\s+(.+)$/);
  if (!dec) return null;
  const normalizedNo = dec[1].trim();
  const firstSeg = normalizedNo.split('.')[0];
  if (/^(19|20)\d{2}$/.test(firstSeg)) return null;
  const body = dec[2].trim().replace(/\s+/g, ' ');
  return { num: null, title: `${normalizedNo}. ${body}` };
}

function parseArticleHeader(line: string, profile: ParseProfile): { num: number | null; title: string } | null {
  const dec = parseDecimalOutlineArticleHeader(line, profile);
  if (dec) return dec;

  const s = stripEnumeratePrefix(line);
  if (profile !== 'english') {
    const m1 = s.match(/^제\s*([0-9IVXLCDMivxlcdm]+)\s*조(?:\s*\(([^)]*)\))?[\s:.)-]*(.*)$/);
    if (m1) {
      const title = [m1[2], m1[3]].filter(Boolean).join(' ').trim();
      return { num: tokenToInt(m1[1]), title: title || '조문' };
    }
  }

  if (profile !== 'korean') {
    const m2 = s.match(/^(article|art\.?)\s*([A-Z]|\d+|[IVXLCDMivxlcdm]+)[\s:.)-]*(.*)$/i);
    if (m2) return { num: tokenToInt(m2[2]), title: (m2[3] || '').trim() || `Article ${m2[2]}` };
  }

  const m3 = s.match(/^([A-Z]|\d+|[IVXLCDMivxlcdm]+)\s*(?:조|article|art\.?)\s*[\s:.)-]*(.*)$/i);
  if (m3 && profile === 'mixed') return { num: tokenToInt(m3[1]), title: (m3[2] || '').trim() || '조문' };
  return null;
}

export function parsePolicyTextToStructure(input: string, profile: ParseProfile = 'mixed'): ParsedPolicyDraft {
  const normalized = preprocessPolicyImportText(input).replace(/\u00A0/g, ' ');
  const lines = normalized.split('\n');

  const chapters: ParsedChapter[] = [];
  let currentChapter: ParsedChapter | null = null;
  let currentArticle: ParsedArticle | null = null;
  let chapterSeq = 1;
  let articleSeq = 1;
  let inPreamble = true;

  const ensureChapter = () => {
    if (currentChapter) return currentChapter;
    currentChapter = { number: chapterSeq, title: '총칙', articles: [], auto: true };
    chapterSeq += 1;
    chapters.push(currentChapter);
    articleSeq = 1;
    return currentChapter;
  };

  const flushArticle = () => {
    if (!currentArticle) return;
    const ch = ensureChapter();
    ch.articles.push({
      ...currentArticle,
      number: currentArticle.number || articleSeq,
      title: currentArticle.title || '조문',
      content: currentArticle.content.trim(),
    });
    articleSeq += 1;
    currentArticle = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const compact = line.trim();
    if (!compact) {
      if (currentArticle) currentArticle.content += '\n';
      continue;
    }

    const ch = parseChapterHeader(compact, profile);
    if (ch) {
      flushArticle();
      currentChapter = {
        number: ch.num || chapterSeq,
        title: ch.title || '총칙',
        articles: [],
      };
      chapterSeq = Math.max(chapterSeq, currentChapter.number + 1);
      chapters.push(currentChapter);
      articleSeq = 1;
      inPreamble = false;
      continue;
    }

    const art = parseArticleHeader(compact, profile);
    if (art) {
      flushArticle();
      ensureChapter();
      currentArticle = {
        number: art.num || articleSeq,
        title: art.title || '조문',
        content: '',
      };
      articleSeq = Math.max(articleSeq, (currentArticle.number || articleSeq) + 1);
      inPreamble = false;
      continue;
    }

    if (inPreamble) continue;
    if (!currentArticle) {
      ensureChapter();
      currentArticle = { number: articleSeq, title: '조문', content: '' };
    }
    currentArticle.content += `${compact}\n`;
  }

  flushArticle();

  for (const chapter of chapters) {
    chapter.articles = chapter.articles.filter((a) => a.content.trim().length > 0 || a.title.trim().length > 0);
  }

  const result: ParsedPolicyDraft = { chapters: chapters.filter((c) => c.articles.length > 0) };
  const meaningful = normalized.replace(/\s+/g, ' ').trim();
  if (result.chapters.length === 0 && meaningful.length >= MIN_FALLBACK_CHARS) {
    return {
      chapters: [
        {
          number: 1,
          title: '원문',
          articles: [{ number: 1, title: '본문', content: normalized.trim() }],
        },
      ],
    };
  }
  return result;
}
