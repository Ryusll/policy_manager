import { describe, it, expect } from 'vitest';
import {
  buildStoredName,
  originalNameFromStored,
  decodeMultipartFilename,
} from '../apps/api/src/policies/upload-name';

/**
 * 첨부파일 이름 (T-90).
 *
 * 삭제 버튼을 붙이기 전에 먼저 고쳐야 했던 것 —
 * 목록에 `1788213942878-919001.pdf` 가 뜨면 어느 파일을 지우는지 알 수 없다.
 */

/** busboy 가 latin1 로 읽어 놓은 상태를 흉내 낸다 */
const asLatin1 = (utf8: string) => Buffer.from(utf8, 'utf8').toString('latin1');

describe('첨부파일 이름 (T-90)', () => {
  describe('multipart 파일명 복원', () => {
    it('latin1 로 읽힌 한글 이름을 되돌린다', () => {
      expect(decodeMultipartFilename(asLatin1('취업규칙 개정본.pdf'))).toBe('취업규칙 개정본.pdf');
    });

    it('원래 ASCII 이름은 건드리지 않는다', () => {
      expect(decodeMultipartFilename('policy-v2.pdf')).toBe('policy-v2.pdf');
    });

    it('이미 올바른 UTF-8 이면 그대로 둔다', () => {
      expect(decodeMultipartFilename('취업규칙.pdf')).toBe('취업규칙.pdf');
    });

    it('빈 값도 터지지 않는다', () => {
      expect(decodeMultipartFilename('')).toBe('');
    });

    /**
     * 이 케이스가 처음 구현을 무너뜨렸다. `가`(U+AC00)의 하위 바이트는 0x00 이라
     * latin1 로 되돌리면 NUL 이 늘어선 문자열이 되는데, 그게 **유효한 UTF-8** 이라
     * "복원에 성공했다"로 보였다. 결과는 조용한 파일명 파괴다.
     */
    it('하위 바이트가 우연히 유효한 UTF-8 이 되는 한글도 건드리지 않는다', () => {
      for (const name of ['가가가.pdf', '가나다라마.docx', '\uAC00\uAC01\uAC02.txt']) {
        expect(decodeMultipartFilename(name)).toBe(name);
      }
    });

    /** 진짜 latin1 이름(유럽어)은 UTF-8 로 읽히지 않으므로 그대로 둔다 */
    it('latin1 원본 이름은 그대로 둔다', () => {
      expect(decodeMultipartFilename('café.pdf')).toBe('café.pdf');
      expect(decodeMultipartFilename('Größe.xlsx')).toBe('Größe.xlsx');
    });
  });

  describe('저장명 ↔ 원래 이름', () => {
    it('한글 이름이 왕복한다', () => {
      const stored = buildStoredName('취업규칙 개정본.pdf');
      expect(originalNameFromStored(stored)).toBe('취업규칙 개정본.pdf');
    });

    it('latin1 로 깨져 들어온 이름도 바로잡아 싣는다', () => {
      const stored = buildStoredName(asLatin1('인사규정(2026).pdf'));
      expect(originalNameFromStored(stored)).toBe('인사규정(2026).pdf');
    });

    it('공백·괄호·한자가 섞여도 왕복한다', () => {
      for (const name of ['별표 3 (서식).xlsx', '規程 全文.docx', 'a b  c.png', '2026년_인사.pdf']) {
        expect(originalNameFromStored(buildStoredName(name))).toBe(name);
      }
    });

    /** T-41 이 세운 저장명 규칙을 그대로 지켜야 한다 */
    it('저장명은 ASCII 안전 문자만 쓴다', () => {
      for (const name of ['취업규칙 개정본.pdf', '別表 1.xlsx', 'a/b\\c.png', '..%2F.pdf']) {
        expect(buildStoredName(name)).toMatch(/^[A-Za-z0-9._-]{1,255}$/);
      }
    });

    it('경로 조각은 떼어 내고 마지막 이름만 쓴다', () => {
      expect(originalNameFromStored(buildStoredName('../../etc/passwd'))).toBe('passwd');
      expect(originalNameFromStored(buildStoredName('C:\\temp\\규정.pdf'))).toBe('규정.pdf');
    });

    it('디스크에서도 알아볼 수 있게 확장자를 남긴다', () => {
      expect(buildStoredName('취업규칙.pdf').endsWith('.pdf')).toBe(true);
      expect(buildStoredName('명부.xlsx').endsWith('.xlsx')).toBe(true);
    });

    it('이름이 없으면 기본값을 쓴다', () => {
      expect(originalNameFromStored(buildStoredName(''))).toBe('file');
    });

    it('아주 긴 이름은 잘라도 저장명 상한을 넘지 않는다', () => {
      const long = '가'.repeat(300) + '.pdf';
      const stored = buildStoredName(long);
      expect(stored.length).toBeLessThanOrEqual(255);
      // 글자 중간에서 자르지 않으므로 되읽어도 깨지지 않는다
      expect(originalNameFromStored(stored)).not.toContain('\uFFFD');
      expect(originalNameFromStored(stored).startsWith('가가가')).toBe(true);
    });

    it('같은 이름을 올려도 저장명은 겹치지 않는다', () => {
      const a = buildStoredName('규정.pdf', 1_700_000_000_000, 1);
      const b = buildStoredName('규정.pdf', 1_700_000_000_000, 2);
      expect(a).not.toBe(b);
      expect(originalNameFromStored(a)).toBe(originalNameFromStored(b));
    });
  });

  /** 이 형식이 생기기 전에 올라간 파일이 목록에서 사라지면 안 된다 */
  describe('옛 파일', () => {
    it('원래 이름을 싣지 않은 저장명은 그대로 보여 준다', () => {
      expect(originalNameFromStored('1788213942878-919001.pdf')).toBe('1788213942878-919001.pdf');
    });

    it('형식이 아닌 이름도 그대로 보여 준다', () => {
      expect(originalNameFromStored('report.pdf')).toBe('report.pdf');
      expect(originalNameFromStored('')).toBe('');
    });
  });
});
