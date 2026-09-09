-- 한국어 전문 검색 가속 (선택).
-- pg_bigm 미지원 환경(기본 postgres 이미지 등)에서도 마이그레이션이 중단되지 않도록 안전 처리합니다.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_bigm') THEN
    BEGIN
      CREATE EXTENSION IF NOT EXISTS pg_bigm;
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE NOTICE 'Skipping pg_bigm extension: insufficient privilege.';
      WHEN OTHERS THEN
        RAISE NOTICE 'Skipping pg_bigm extension due to error: %', SQLERRM;
    END;

    IF EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'article_versions'
    ) THEN
      BEGIN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_article_versions_content_pgbigm ON article_versions USING gin (content gin_bigm_ops)';
      EXCEPTION
        WHEN undefined_object THEN
          RAISE NOTICE 'Skipping pg_bigm index: gin_bigm_ops is unavailable.';
        WHEN OTHERS THEN
          RAISE NOTICE 'Skipping pg_bigm index due to error: %', SQLERRM;
      END;
    ELSE
      RAISE NOTICE 'Skipping pg_bigm index: article_versions table not found.';
    END IF;
  ELSE
    RAISE NOTICE 'Skipping pg_bigm: extension is not available on this server.';
  END IF;
END $$;
