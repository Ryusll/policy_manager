-- 규정 질문 점검 (읽기 전용, T-146 — 런북 7-9). T-146 마이그레이션의 동의 칸을 읽으므로 그 배포 뒤에만 돈다.
--
-- 1) 켜진 회사 — T-146 배포 직후에는 없다(모든 회사가 꺼진 채 시작한다). 저장값 기준이라, 동의한 고지 판이
--    지금 판과 다르면 실제로는 꺼진 것과 같다. 최근_하루_답한_질문은 AI 가 실제로 답해 모델이 기록된 질문 수다
--    (7-9 4단계에서 "AI 를 실제로 불렀는가"를 이것으로 본다).
-- 2) AI 를 부른 질문 — 회사별, 전체 기간(파기 전까지 남은 기록, 실패한 호출 포함). 운영 키를 넣기 전(7-9 1단계 —
--    T-146 배포 직후, 파기 cron 전)에는 비어 있어야 한다. 있으면 동의 절차 없이 이미 외부로 나간 것이니 사고로 다룬다.
-- 3) 가장 오래된 질문 기록 — 파기 cron 이 돌면 지난 일수(하루 미만은 버림)가 90 을 넘지 않는다(하루 한 번, 정확히
--    90일 기준으로 지운다). 90 을 넘으면 파기를 한 번 이상 놓친 것이다.
-- 질문·답 내용은 출력하지 않는다(회사 코드·이름·날짜·건수만).
BEGIN TRANSACTION READ ONLY;

-- created_at·ai_qa_consented_at 은 UTC 로 저장된다 — 접속의 시간대와 상관없이 UTC 끼리 견준다
SELECT t.slug                 AS 회사_코드,
       t.name                 AS 회사_이름,
       t.ai_qa_notice_version AS 동의한_고지_판,
       t.ai_qa_consented_at   AS 동의_시각_utc,
       (SELECT count(*)
          FROM ai_qa_logs l
         WHERE l.tenant_id = t.id
           AND l.model IS NOT NULL
           AND l.created_at > (now() AT TIME ZONE 'UTC') - interval '1 day') AS 최근_하루_답한_질문
  FROM tenants t
 WHERE t.ai_qa_enabled
 ORDER BY t.ai_qa_consented_at;

SELECT count(*) AS 켜진_회사_수
  FROM tenants
 WHERE ai_qa_enabled;

SELECT t.slug             AS 회사_코드,
       t.name             AS 회사_이름,
       count(*)           AS 부른_질문_수,
       min(l.created_at)  AS 처음_utc,
       max(l.created_at)  AS 마지막_utc
  FROM ai_qa_logs l
  JOIN tenants t ON t.id = l.tenant_id
 WHERE l.ai_called
 GROUP BY t.slug, t.name
 ORDER BY max(l.created_at) DESC;

SELECT min(created_at)                                               AS 가장_오래된_기록_utc,
       date_part('day', (now() AT TIME ZONE 'UTC') - min(created_at)) AS 지난_일수
  FROM ai_qa_logs;

ROLLBACK;
