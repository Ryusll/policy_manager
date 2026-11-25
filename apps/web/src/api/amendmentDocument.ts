import client from './client';

/**
 * 개정안 문서 PDF(T-162) — 같은 규정의 개정 후보를 신구조문대비표(현행·개정안·비고)·개정 이유·법령 근거 한 부로.
 * 서버가 DB 에서 조립한다(화면 HTML 을 보내지 않는다). 반려·다른 규정·같은 조문 둘·낡은 후보는 400, 열람자는 403.
 */
export async function downloadAmendmentDocument(candidateIds: string[]): Promise<{ blob: Blob; filename: string }> {
  const r = await client.post('/amendments/document/pdf', { candidateIds }, { responseType: 'blob' });
  const disposition = String(r.headers['content-disposition'] ?? '');
  const m = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  return { blob: r.data as Blob, filename: m ? decodeURIComponent(m[1]) : 'amendment.pdf' };
}

/** 한 문서에 넣을 수 있는 후보 수(서버 DTO 와 같다) */
export const AMENDMENT_DOC_MAX = 50;

/** blob 으로 받은 오류 응답 — 상태와 서버가 붙인 코드·문구. 본문을 읽을 수 없으면 코드·문구 없이 */
export async function amendmentDocumentError(err: unknown): Promise<{ status: number; code?: string; article?: string }> {
  const res = (err as { response?: { status?: number; data?: unknown } })?.response;
  const status = res?.status ?? 0;
  if (!(res?.data instanceof Blob)) return { status };
  try {
    const body = JSON.parse(await res.data.text()) as { code?: unknown; article?: unknown };
    return { status, code: typeof body.code === 'string' ? body.code : undefined, article: typeof body.article === 'string' ? body.article : undefined };
  } catch {
    // JSON 이 아닌 오류 본문(프록시 오류 페이지 등) — 상태만
    return { status };
  }
}
