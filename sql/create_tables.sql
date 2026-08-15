-- Postgres schema for users, orders, sponsorships

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  phone TEXT UNIQUE,
  nickname TEXT,
  role TEXT NOT NULL,
  level TEXT,
  avatar TEXT,
  note TEXT,
  last_ip TEXT,
  last_region TEXT,
  last_login_at BIGINT,
  last_active_at BIGINT,
  gemini_edit_daily_limit BIGINT,
  qwen_edit_daily_limit BIGINT,
  model_gen_daily_limit BIGINT,
  gemini_edit_used_today BIGINT DEFAULT 0,
  qwen_edit_used_today BIGINT DEFAULT 0,
  model_gen_used_today BIGINT DEFAULT 0,
  extra_credits JSONB DEFAULT '{}'::jsonb,
  usage_ledger JSONB DEFAULT '[]'::jsonb,
  watermark_enabled BOOLEAN DEFAULT true,
  usage_day_key TEXT,
  sponsorships JSONB DEFAULT '[]'::jsonb,
  created_at BIGINT DEFAULT (extract(epoch from now()) * 1000),
  updated_at BIGINT DEFAULT (extract(epoch from now()) * 1000)
);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  out_trade_no TEXT UNIQUE,
  user_id UUID REFERENCES users(id),
  amount_fen BIGINT NOT NULL,
  amount_yuan NUMERIC NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  code_url TEXT,
  expire_at BIGINT,
  transaction_id TEXT,
  payer_openid TEXT,
  metadata JSONB,
  paid_at BIGINT,
  created_at BIGINT DEFAULT (extract(epoch from now()) * 1000),
  updated_at BIGINT DEFAULT (extract(epoch from now()) * 1000)
);

CREATE TABLE IF NOT EXISTS sponsorships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor_id UUID REFERENCES users(id),
  target_user_id UUID REFERENCES users(id),
  amount_cents BIGINT,
  message TEXT,
  out_trade_no TEXT,
  transaction_id TEXT,
  pay_channel TEXT,
  paid_at BIGINT,
  created_at BIGINT DEFAULT (extract(epoch from now()) * 1000)
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT,
  storage_path TEXT, -- e.g. projects/{ownerId}/{id}/
  manifest JSONB DEFAULT '{}',
  version BIGINT DEFAULT 0,
  created_at BIGINT DEFAULT (extract(epoch from now()) * 1000),
  updated_at BIGINT DEFAULT (extract(epoch from now()) * 1000)
);
CREATE INDEX IF NOT EXISTS projects_owner_id_idx ON projects (owner_id);
