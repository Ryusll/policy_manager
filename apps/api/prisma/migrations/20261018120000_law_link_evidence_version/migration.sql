-- T-177(PAT-08, 특허 도 3 S320): 법령 관계 정보의 근거 문구가 어느 사내 조문 판의 본문에서 나왔는지 — 원천 판을 남긴다.
-- 연결 대상은 그대로 조문(article_id)이다. 판이 지워지면(재파싱 묶음 반려) 원천만 비운다.

ALTER TABLE "law_links" ADD COLUMN "evidence_version_id" TEXT,
ADD COLUMN "evidence_from_body" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "law_links_evidence_version_id_idx" ON "law_links"("evidence_version_id");

ALTER TABLE "law_links" ADD CONSTRAINT "law_links_evidence_version_id_fkey" FOREIGN KEY ("evidence_version_id") REFERENCES "article_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 이미 있는 연결 채우기 — apps/api/src/law-links/evidence-version.ts 의 pickEvidenceVersion 과 같은 규칙(고치면 둘 다 — 시험이 같은지 본다):
--   근거 문구와 판 본문에서 공백(JS \s 와 같은 문자 모음)을 지우고, 근거 문구(공백 빼고 4자 이상)를 담은 같은 조문의 판 가운데
--   오늘(한국 날짜) 시행 중인 판(오늘 폐지 상태면 없음) 먼저, 없으면 판 번호가 가장 큰 판. 못 찾으면 비워 둔다. 당시 기록이 아니라
--   지금 판들로 다시 짠 값이다. 연결마다 그 조문의 판만 읽는다(article_versions 의 조문 색인) — 연결 수 × 조문당 판 수에 비례한다.
-- [evidence-fill:start]
UPDATE "law_links" l
SET "evidence_version_id" = (
  SELECT av.id
  FROM article_versions av
  WHERE av.article_id = l.article_id
    AND position(
      regexp_replace(l.evidence_text, '[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+', '', 'g')
      IN regexp_replace(av.content, '[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+', '', 'g')
    ) > 0
  ORDER BY (av.id = (
      -- 오늘 시행 중인 판 — common/as-of 의 "현재" 규칙(currentVersionIdsSql). 고른 판이 오늘 폐지 상태면 없다(asOfState)
      SELECT CASE WHEN cv.repealed_on IS NOT NULL AND cv.repealed_on <= (now() AT TIME ZONE 'Asia/Seoul')::date THEN NULL ELSE cv.id END
      FROM article_versions cv
      WHERE cv.article_id = l.article_id
        AND cv.status IN ('published', 'archived')
        AND (cv.effective_date IS NULL OR cv.effective_date <= (now() AT TIME ZONE 'Asia/Seoul')::date)
      ORDER BY cv.effective_date DESC NULLS LAST, cv.version_num DESC
      LIMIT 1
    )) DESC NULLS LAST,
    av.version_num DESC
  LIMIT 1
)
WHERE l.evidence_version_id IS NULL
  AND l.evidence_text IS NOT NULL
  AND char_length(regexp_replace(l.evidence_text, '[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+', '', 'g')) >= 4;
-- [evidence-fill:end]

-- 채운 원천이 있으면 본문에서 찾은 근거다(본문 밖 문구는 false 그대로 — 화면이 "지금 본문에 없음"을 알리지 않는다)
UPDATE "law_links" SET "evidence_from_body" = true WHERE "evidence_version_id" IS NOT NULL;
