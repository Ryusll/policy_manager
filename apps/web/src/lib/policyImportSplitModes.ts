import { parsePolicyTextToStructure, type ParseProfile, type ParsedPolicyDraft } from './policyImportParser';

export type ImportSplitMode = 'auto' | 'blank_block' | 'line_each' | 'delimiter' | 'markdown';

type ParsedChapter = ParsedPolicyDraft['chapters'][number];
type ParsedArticle = ParsedChapter['articles'][number];

function singleChapter(title: string, articles: ParsedArticle[]): ParsedPolicyDraft {
  return { chapters: [{ number: 1, title, articles }] };
}

/** 구분 모드에 따라 원문 → 장/조 초안 */
export function parsePolicyTextWithSplitMode(
  input: string,
  mode: ImportSplitMode,
  delimiter: string,
  parseProfile: ParseProfile,
): ParsedPolicyDraft {
  if (mode === 'auto') {
    return parsePolicyTextToStructure(input, parseProfile);
  }

  const text = String(input || '').trim();
  if (!text) return { chapters: [] };

  if (mode === 'blank_block') {
    const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
    const articles: ParsedArticle[] = blocks.map((block, i) => {
      const lines = block.split('\n').map((l) => l.trimEnd());
      const first = (lines[0] || '').trim();
      const rest = lines.slice(1).join('\n').trim();
      if (rest) {
        return {
          number: i + 1,
          title: first.slice(0, 120) || `항목 ${i + 1}`,
          content: rest,
        };
      }
      const full = lines.join('\n').trim();
      const title = full.slice(0, 100) + (full.length > 100 ? '…' : '');
      return {
        number: i + 1,
        title: title || `항목 ${i + 1}`,
        content: full,
      };
    });
    return singleChapter('원문', articles);
  }

  if (mode === 'line_each') {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const articles: ParsedArticle[] = lines.map((line, i) => ({
      number: i + 1,
      title: line.slice(0, 100) + (line.length > 100 ? '…' : ''),
      content: line,
    }));
    return singleChapter('원문', articles);
  }

  if (mode === 'delimiter') {
    const d = delimiter.trim();
    if (!d) return { chapters: [] };
    const parts = text.split(d).map((p) => p.trim()).filter(Boolean);
    const articles: ParsedArticle[] = parts.map((part, i) => ({
      number: i + 1,
      title: `항목 ${i + 1}`,
      content: part,
    }));
    return singleChapter('원문', articles);
  }

  if (mode === 'markdown') {
    const lines = text.split('\n');
    const chapters: ParsedChapter[] = [];
    let chapter: ParsedChapter | null = null;
    let article: ParsedArticle | null = null;
    let chapterNum = 0;
    let articleNum = 0;

    const flushArticle = () => {
      if (!chapter || !article) return;
      if (article.title.trim() || article.content.trim()) {
        chapter.articles.push({
          number: article.number,
          title: article.title.trim() || '조문',
          content: article.content.trim(),
        });
      }
      article = null;
    };

    const startChapter = (title: string) => {
      flushArticle();
      chapterNum += 1;
      articleNum = 0;
      chapter = { number: chapterNum, title, articles: [] };
      chapters.push(chapter);
    };

    const ensureDefaultChapter = () => {
      if (!chapter) startChapter('원문');
    };

    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (!trimmed) {
        if (article) article.content += '\n';
        continue;
      }

      const h = trimmed.match(/^(#+)\s+(.+)$/);
      if (h) {
        const level = h[1].length;
        const title = h[2].trim();
        if (level === 1) {
          startChapter(title);
          continue;
        }
        flushArticle();
        ensureDefaultChapter();
        articleNum += 1;
        article = { number: articleNum, title, content: '' };
        continue;
      }

      ensureDefaultChapter();
      if (!article) {
        articleNum += 1;
        article = { number: articleNum, title: '본문', content: rawLine.trimEnd() };
      } else {
        article.content += (article.content ? '\n' : '') + rawLine.trimEnd();
      }
    }

    flushArticle();

    for (const ch of chapters) {
      ch.articles = ch.articles.filter((a) => a.title.trim() || a.content.trim());
    }
    return { chapters: chapters.filter((c) => c.articles.length > 0) };
  }

  return { chapters: [] };
}
