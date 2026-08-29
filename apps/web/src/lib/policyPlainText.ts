import { articleShortLabel, isChapterHeaderHidden } from './legalArticleLabel';

/**
 * 전문 텍스트(.txt) 내보내기 본문 만들기.
 *
 * 화면(TemplateRenderer)·인쇄 HTML(templateUtils)·읽어주기(speech)는 모두
 * `isChapterHeaderHidden` 을 거치는데 **여기만 거치지 않아서**, 장이 없는 규정을
 * 내보내면 `===== 제1장  =====` 라는 유령 장 제목이 찍혔다(T-84 감사에서 발견).
 *
 * `Article.chapterId` 가 필수라 "장 없는 규정"은 숨김 장(`suppressHeader`)이라는
 * **관례**로 표현된다([ADR-0011](../../../docs/Deliverables/10_ADR_의사결정기록/ADR.md)).
 * 관례를 모르는 코드가 하나만 있어도 이렇게 샌다 — 그래서 컴포넌트 안에 있던
 * 문자열 조립을 여기로 꺼내 테스트로 묶었다.
 */

export type PlainTextAppendix = {
  kind?: string;
  title?: string | null;
  body?: string | null;
};

export type PlainTextInput = {
  policy: { code?: string | null; title?: string | null };
  /** `buildFullViewGroups` 결과 — 장마다 `allGroups` 를 갖는다 */
  chapters: any[];
  appendices?: PlainTextAppendix[];
  /** 부록 종류 코드 → 표시 이름 */
  appendixKindLabel?: Record<string, string>;
};

export function buildPolicyPlainText(input: PlainTextInput): string {
  const { policy, chapters, appendices = [], appendixKindLabel = {} } = input;
  const lines: string[] = [`${policy.code ?? ''} ${policy.title ?? ''}`.trim(), ''];

  for (const chapter of chapters || []) {
    lines.push('');
    // 숨김 장은 제목 줄 자체를 쓰지 않는다. 조문은 그대로 이어 붙는다.
    if (!isChapterHeaderHidden(chapter)) {
      lines.push(`===== 제${chapter.number}장 ${String(chapter.title ?? '').trim()} =====`);
    }
    // 절 소속 조문도 빠짐없이 담는다(allGroups 는 절 소속 여부와 무관한 조 번호 순)
    for (const group of chapter.allGroups || []) {
      for (const article of group.items || []) {
        lines.push('');
        lines.push(`${articleShortLabel(article)} ${article.title || ''}`.trimEnd());
        lines.push(String(article.versions?.[0]?.content || '').trim());
      }
    }
  }

  if (appendices.length) {
    lines.push('');
    lines.push('===== 부칙·별표·서식 =====');
    for (const appendix of appendices) {
      lines.push('');
      const label = appendixKindLabel[String(appendix.kind)] || appendix.kind || '';
      lines.push(`[${label}] ${appendix.title || ''}`.trimEnd());
      lines.push(String(appendix.body || '').trim());
    }
  }

  return lines.join('\n');
}

/** 파일명은 규정 코드를 쓰되 경로·확장자로 오해될 문자를 지운다 */
export function policyPlainTextFilename(code?: string | null): string {
  return `${String(code || 'policy').replace(/[^\w.-]+/g, '_')}-full.txt`;
}
