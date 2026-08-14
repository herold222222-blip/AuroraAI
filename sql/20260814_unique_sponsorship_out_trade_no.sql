-- Migration: add unique index to sponsorships.out_trade_no to prevent duplicates
-- Safe to run multiple times.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_sponsorships_out_trade_no'
  ) THEN
    CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_sponsorships_out_trade_no ON sponsorships(out_trade_no) WHERE out_trade_no IS NOT NULL;
  END IF;
EXCEPTION WHEN others THEN
  -- In case CONCURRENTLY is not allowed inside transaction, fall back to non-concurrent create
  RAISE NOTICE 'CONCURRENT creation failed, trying non-concurrent';
  BEGIN
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sponsorships_out_trade_no ON sponsorships(out_trade_no) WHERE out_trade_no IS NOT NULL;
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'Index creation failed: %', SQLERRM;
  END;
END$$;
