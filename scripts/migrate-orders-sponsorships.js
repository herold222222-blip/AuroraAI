#!/usr/bin/env node
/**
 * 简单的 orders / sponsorships 迁移脚本
 * 读取 server/.data/orders.json 与 server/.data/sponsorships.json（若存在）
 * 将数据插入到 Postgres 的 orders 与 sponsorships 表中（逐条写入，带事务）
 * 仅作为初始迁移模板，运行前请备份数据库。
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const DATA_DIR = path.join(__dirname, '..', 'server', '.data');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const SPONS_FILE = path.join(DATA_DIR, 'sponsorships.json');

async function loadJson(file) {
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, 'utf8');
  try { return JSON.parse(raw); } catch (e) { console.error('解析 JSON 失败', file, e); return []; }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('请先设置 DATABASE_URL 环境变量');
    process.exit(1);
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const orders = await loadJson(ORDERS_FILE);
  const sponsorships = await loadJson(SPONS_FILE);

  console.log('找到订单:', orders.length, '找到赞赏记录:', sponsorships.length);

  // 迁移 orders
  let ordersInserted = 0;
  for (const o of orders) {
    try {
      await client.query('BEGIN');
      const q = `INSERT INTO orders(id, out_trade_no, user_id, amount, status, created_at, updated_at, metadata)
                  VALUES($1,$2,$3,$4,$5,$6,$7,$8)
                  ON CONFLICT (id) DO NOTHING`;
      const metadata = o.metadata ? o.metadata : null;
      await client.query(q, [o.id, o.out_trade_no || o.outTradeNo || null, o.user_id || o.userId || null, o.amount || 0, o.status || 'unknown', o.created_at || o.createdAt || new Date(), o.updated_at || o.updatedAt || new Date(), metadata]);
      await client.query('COMMIT');
      ordersInserted++;
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('迁移订单失败，跳过：', o.id, e.message);
    }
  }

  // 迁移 sponsorships
  let sponsInserted = 0;
  for (const s of sponsorships) {
    try {
      await client.query('BEGIN');
      const q = `INSERT INTO sponsorships(id, order_id, user_id, amount, created_at, message)
                  VALUES($1,$2,$3,$4,$5,$6)
                  ON CONFLICT (id) DO NOTHING`;
      await client.query(q, [s.id, s.order_id || s.orderId || null, s.user_id || s.userId || null, s.amount || 0, s.created_at || s.createdAt || new Date(), s.message || null]);
      await client.query('COMMIT');
      sponsInserted++;
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('迁移赞赏失败，跳过：', s.id, e.message);
    }
  }

  console.log('迁移完成；ordersInserted=', ordersInserted, 'sponsorshipsInserted=', sponsInserted);
  await client.end();
}

main().catch(err => { console.error(err); process.exit(1); });
