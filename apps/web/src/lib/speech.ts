/**
 * 본문 음성 읽기 (T-81).
 *
 * 브라우저 내장 `SpeechSynthesis` 를 쓴다. 외부 TTS 서비스로 보내지 않는 이유는
 * 규정 본문이 사내 문서이기 때문이다 — 읽어주자고 전문을 외부에 넘길 이유가 없다.
 * 설치할 것도, CSP 예외도 없다.
 *
 * 긴 문장을 통째로 넘기면 브라우저마다 중간에서 끊긴다(크롬은 대략 200~300자 근처).
 * 그래서 문장 단위로 잘라 큐로 넣는다.
 */

import { formatArticleJo, isChapterHeaderHidden } from './legalArticleLabel';
import { noCurrentTextMarker, type CurrentViewArticle } from './versionState';

export const SPEECH_CHUNK_LIMIT = 180;

export type SpeakableArticle = CurrentViewArticle & {
  number: number;
  branchNumber?: number | null;
  clauseNumber?: number | null;
  itemNumber?: number | null;
  title?: string | null;
  /** 본문을 따로 줄 때. 규정 상세의 조문은 본문이 `versions[0]`(오늘 시행 중인 버전)에 있다 */
  content?: string | null;
};

/** 읽어줄 문장으로 만든다. 화면의 번호 표기(①)가 아니라 말로 읽는 표기를 쓴다. */
export function articleToSpeech(article: SpeakableArticle): string {
  const parts: string[] = [];
  if (article.clauseNumber == null && article.itemNumber == null) {
    parts.push(formatArticleJo(article.number, article.branchNumber));
    if (article.title) parts.push(article.title);
  } else if (article.itemNumber != null) {
    parts.push(`제${article.itemNumber}목`);
  } else {
    parts.push(`제${article.clauseNumber}항`);
  }
  // 조문 행에는 본문 칸이 없다 — 예전에는 `article.content` 만 봐서 번호·제목만 읽었다.
  // 오늘 시행 중인 본문을 읽고, 없으면 인쇄와 같은 "삭제 <날짜>"·"날짜 시행 예정"(T-127)
  const text = article.content ?? article.versions?.[0]?.content ?? noCurrentTextMarker(article) ?? '';
  const body = text.replace(/\s+/g, ' ').trim();
  if (body) parts.push(body);
  return parts.join('. ');
}

/**
 * 문장 단위로 자른다. 한 문장이 한도를 넘으면 쉼표에서, 그래도 길면 글자 수로 자른다.
 * 자르는 위치가 어색해도 읽다 마는 것보다 낫다.
 */
export function chunkForSpeech(text: string, limit = SPEECH_CHUNK_LIMIT): string[] {
  const normalized = (text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return [];

  const out: string[] = [];
  let buffer = '';

  const flush = () => {
    const value = buffer.trim();
    if (value) out.push(value);
    buffer = '';
  };

  for (const sentence of normalized.split(/(?<=[.!?。])\s+/)) {
    if (sentence.length > limit) {
      flush();
      let rest = sentence;
      while (rest.length > limit) {
        const comma = rest.lastIndexOf(',', limit);
        const cut = comma > limit * 0.4 ? comma + 1 : limit;
        out.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      if (rest) buffer = rest;
      continue;
    }
    if ((buffer + ' ' + sentence).trim().length > limit) flush();
    buffer = buffer ? `${buffer} ${sentence}` : sentence;
  }
  flush();
  return out.filter(Boolean);
}

/** 전문 보기 그룹 전체를 읽을 문장 목록으로 */
export function buildPolicySpeech(chapters: any[], policyTitle?: string): string[] {
  const lines: string[] = [];
  if (policyTitle) lines.push(policyTitle);

  for (const chapter of chapters || []) {
    const hidden = isChapterHeaderHidden(chapter);
    if (!hidden) lines.push(`제${chapter.number}장 ${chapter.title}`);
    for (const block of chapter.blocks || []) {
      if (block.kind === 'section') lines.push(`제${block.number}절 ${block.title}`);
      for (const group of block.groups || []) {
        for (const article of group.items || []) lines.push(articleToSpeech(article));
      }
    }
  }
  return chunkForSpeech(lines.join(' '));
}

/** 이 브라우저가 음성 읽기를 지원하는지 */
export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}
