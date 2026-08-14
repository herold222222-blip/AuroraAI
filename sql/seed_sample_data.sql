-- Seed sample user and a pending order for testing
-- 运行前请确保已执行 sql/create_tables.sql

BEGIN;

WITH u AS (
  INSERT INTO users (username, password_hash, role, nickname, created_at, updated_at)
  VALUES ('testuser', '', 'user', '测试用户', (extract(epoch from now()) * 1000)::bigint, (extract(epoch from now()) * 1000)::bigint)
  RETURNING id
)
INSERT INTO orders (out_trade_no, user_id, amount_fen, amount_yuan, status, message, code_url, expire_at, created_at, updated_at)
SELECT 'AURTEST1', u.id, 100, 1.00, 'pending', '测试打赏', 'http://example.com/qrcode', ((extract(epoch from now()) * 1000)::bigint + 3600000), (extract(epoch from now()) * 1000)::bigint, (extract(epoch from now()) * 1000)::bigint
FROM u;

COMMIT;

-- 查询以确认
-- SELECT * FROM users WHERE username='testuser';
-- SELECT * FROM orders WHERE out_trade_no='AURTEST1';
