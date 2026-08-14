#!/usr/bin/env node
// Simple migration script: read local users.json (if exists) and insert into Postgres.
// Usage: node scripts/migrate-to-postgres.js --db $DATABASE_URL

import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';

const DATA_FILE = path.join(new URL('../server', import.meta.url).pathname, '.data/users.json');

function usageAndExit() {
  console.error('Usage: DATABASE_URL env required');
  process.exit(2);
}

const dbUrl = process.env.DATABASE_URL || process.argv[2];
if (!dbUrl) usageAndExit();

const pool = new Pool({ connectionString: dbUrl });

async function migrate() {
  if (!fs.existsSync(DATA_FILE)) {
    console.log('no local users file at', DATA_FILE);
    process.exit(0);
  }
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  const parsed = JSON.parse(raw);
  const users = parsed.users || [];
  console.log(`Found ${users.length} users to migrate`);

  for (const u of users) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO users (id, username, password_hash, phone, nickname, role, level, avatar, note, last_ip, last_region, last_login_at, last_active_at, gemini_edit_daily_limit, qwen_edit_daily_limit, model_gen_daily_limit, gemini_edit_used_today, qwen_edit_used_today, model_gen_used_today, extra_credits, usage_ledger, watermark_enabled, usage_day_key, sponsorships, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
         ON CONFLICT (username) DO UPDATE SET phone=EXCLUDED.phone, nickname=EXCLUDED.nickname, updated_at=EXCLUDED.updated_at`,
        [
          u.id,
          u.username,
          u.passwordHash || '',
          u.phone || null,
          u.nickname || null,
          u.role || 'user',
          u.level || 'normal',
          u.avatar || null,
          u.note || null,
          u.lastIp || null,
          u.lastRegion || null,
          u.lastLoginAt || null,
          u.lastActiveAt || null,
          u.geminiEditDailyLimit || null,
          u.qwenEditDailyLimit || null,
          u.modelGenDailyLimit || null,
          u.geminiEditUsedToday || 0,
          u.qwenEditUsedToday || 0,
          u.modelGenUsedToday || 0,
          JSON.stringify(u.extraCredits || {}),
          JSON.stringify(u.usageLedger || []),
          u.watermarkEnabled === false ? false : true,
          u.usageDayKey || null,
          JSON.stringify(u.sponsorships || []),
          u.createdAt || Date.now(),
          u.updatedAt || Date.now(),
        ],
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('failed to insert', u.username, e.message || e);
    } finally {
      client.release();
    }
  }
  await pool.end();
  console.log('migration complete');
}

migrate().catch((e) => {
  console.error(e);
  process.exit(1);
});
