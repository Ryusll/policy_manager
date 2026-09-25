import { describe, it, expect } from 'vitest';
import {
  LAW_NORMALIZATION_VERSION,
  lawAggregateVersionKey,
  lawVersionKey,
  normalizeLawText,
  versionKeyRuleVersion,
} from '../apps/api/src/laws/law-version-key';

describe('normalizeLawText', () => {
  it('정렬용 공백·개행 차이는 지운다 (법제처 응답이 수시로 바뀌는 부분)', () => {
    const a = '   제1조(목적)  이 법은\r\n\r\n   근로조건의 기준을 정한다.  ';
    const b = '제1조(목적) 이 법은\n근로조건의 기준을 정한다.';
    expect(normalizeLawText(a)).toBe(normalizeLawText(b));
  });

  it('보이지 않는 문자(NBSP·ZWSP·BOM)를 공백으로 본다', () => {
    expect(normalizeLawText('가 나​다﻿라')).toBe('가 나 다 라');
  });

  it('한글 자모 분리 표기(NFD)를 합친 표기로 맞춘다', () => {
    const nfc = '근로기준법';
    expect(normalizeLawText(nfc.normalize('NFD'))).toBe(nfc);
  });

  it('개행은 공백과 같게 본다 — 법제처가 줄바꿈만 바꿔도 개정으로 잡히면 안 된다', () => {
    expect(normalizeLawText('1.\n가.\n나.')).toBe('1. 가. 나.');
  });

  it('문장부호와 개정 표기는 남긴다 — 실제 개정에서 바뀌는 내용이다', () => {
    const out = normalizeLawText('제1장 총칙 <개정 2009.2.6>');
    expect(out).toBe('제1장 총칙 <개정 2009.2.6>');
  });
});

describe('lawVersionKey', () => {
  it('공백만 다른 본문은 같은 지문 (개정으로 오인하지 않는다)', () => {
    expect(lawVersionKey('이 법은  근로조건의 기준을 정한다.')).toBe(
      lawVersionKey(' 이 법은 근로조건의 기준을\n정한다. '),
    );
  });

  it('한 글자라도 실제로 바뀌면 다른 지문', () => {
    expect(lawVersionKey('1주 40시간')).not.toBe(lawVersionKey('1주 52시간'));
  });

  it('정규화 규칙 버전이 접두어로 붙는다 — 규칙이 바뀌면 재계산 대상을 찾을 수 있어야 한다', () => {
    const key = lawVersionKey('아무 본문');
    expect(key.startsWith(`v${LAW_NORMALIZATION_VERSION}:`)).toBe(true);
    expect(versionKeyRuleVersion(key)).toBe(LAW_NORMALIZATION_VERSION);
    // sha256 16진 64자
    expect(key.split(':')[1]).toMatch(/^[0-9a-f]{64}$/);
  });

  it('빈 본문도 지문을 낸다 (조문 신설 직후 본문이 비어 올 수 있다)', () => {
    expect(lawVersionKey('')).toBe(lawVersionKey(null));
    expect(versionKeyRuleVersion(lawVersionKey(undefined))).toBe(LAW_NORMALIZATION_VERSION);
  });
});

describe('lawAggregateVersionKey', () => {
  it('조항 지문이 같고 순서도 같으면 같은 법령 지문', () => {
    expect(lawAggregateVersionKey(['a', 'b', 'c'])).toBe(lawAggregateVersionKey(['a', 'b', 'c']));
  });

  it('순서가 달라지면 다른 지문 — 조문 신설·삭제도 개정이다', () => {
    expect(lawAggregateVersionKey(['a', 'b', 'c'])).not.toBe(lawAggregateVersionKey(['a', 'c', 'b']));
  });

  it('조항이 하나 늘면 다른 지문', () => {
    expect(lawAggregateVersionKey(['a', 'b'])).not.toBe(lawAggregateVersionKey(['a', 'b', 'c']));
  });
});
