import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getPool } from './db';
import storage from './storage';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '.data');
const DATA_FILE = join(DATA_DIR, 'pay-orders.json');

export type PayOrderStatus =
  | 'pending'
  | 'user_paying'
  | 'paid'
  | 'closed'
  | 'expired';

export interface PayOrder {
  id: string;
  outTradeNo: string;
  userId: string;
  /** 服务端校验后的金额（分） */
  amountFen: number;
  /** 元，展示用 */
  amountYuan: number;
  message: string;
  status: PayOrderStatus;
  codeUrl: string;
  expireAt: number;
  createdAt: number;
  updatedAt: number;
  transactionId?: string;
  paidAt?: number;
  payerOpenid?: string;
}

type DbShape = { orders: PayOrder[] };

function emptyDb(): DbShape {
  return { orders: [] };
}

function epochMs(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : undefined;
  }
  const n = typeof value === 'number' ? value : Number(value);
  if (Number.isFinite(n) && n > 0) {
    return n < 1e12 ? Math.round(n * 1000) : n;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function uid(prefix = 'ord'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export function newOutTradeNo(): string {
  // 商户订单号：最长 32
  const t = Date.now().toString(36).toUpperCase();
  const r = Math.random().toString(36).slice(2, 10).toUpperCase();
  return `AUR${t}${r}`.slice(0, 32);
}

async function readFileDb(): Promise<DbShape> {
  try {
    if (!existsSync(DATA_FILE)) return emptyDb();
    const raw = readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw) as DbShape;
    if (!parsed?.orders || !Array.isArray(parsed.orders)) return emptyDb();
    return { orders: parsed.orders };
  } catch {
    return emptyDb();
  }
}

async function writeFileDb(db: DbShape): Promise<void> {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
}

async function readBlobDb(): Promise<DbShape | null> {
  try {
    const { getStore } = await import('@netlify/blobs');
    const store = getStore('aurora-pay-orders');
    const raw = await store.get('db', { type: 'text' });
    if (!raw) return emptyDb();
    const parsed = JSON.parse(raw) as DbShape;
    if (!parsed?.orders || !Array.isArray(parsed.orders)) return emptyDb();
    return { orders: parsed.orders };
  } catch {
    return null;
  }
}

async function writeBlobDb(db: DbShape): Promise<boolean> {
  try {
    const { getStore } = await import('@netlify/blobs');
    const store = getStore('aurora-pay-orders');
    await store.set('db', JSON.stringify(db));
    return true;
  } catch {
    return false;
  }
}

async function loadDb(): Promise<DbShape> {
  if (process.env.NETLIFY === 'true' || process.env.NETLIFY_BLOBS) {
    const blob = await readBlobDb();
    if (blob) return blob;
  }
  // If remote-only mode, do not fall back to file
  if (storage.isForceRemote()) {
    throw new Error('No remote orders store available but FORCE_USE_REMOTE_STORAGE=true');
  }
  return readFileDb();
}

async function saveDb(db: DbShape): Promise<void> {
  const usedBlob = await writeBlobDb(db);
  if (!usedBlob) {
    if (storage.isForceRemote()) {
      throw new Error('Failed to write blob store and FORCE_USE_REMOTE_STORAGE=true');
    }
    await writeFileDb(db);
  }
}

function isOpenStatus(s: PayOrderStatus): boolean {
  return s === 'pending' || s === 'user_paying';
}

export async function findOrderByOutTradeNo(
  outTradeNo: string,
): Promise<PayOrder | null> {
  const no = String(outTradeNo || '').trim();
  if (!no) return null;

  if (process.env.DATABASE_URL) {
    try {
      const pool = getPool();
      const res = await pool.query(
        'SELECT * FROM orders WHERE out_trade_no=$1',
        [no],
      );
      if (res.rows?.length) {
        const r = res.rows[0];
        return {
          id: r.id,
          outTradeNo: r.out_trade_no,
          userId: r.user_id,
          amountFen: Number(r.amount_fen),
          amountYuan: Number(r.amount_yuan),
          message: r.message,
          status: r.status,
          codeUrl: r.code_url,
          expireAt: Number(r.expire_at || 0),
          createdAt: epochMs(r.created_at) || 0,
          updatedAt: epochMs(r.updated_at) || 0,
          transactionId: r.transaction_id || undefined,
          paidAt: epochMs(r.paid_at),
          payerOpenid: r.payer_openid || undefined,
        } as PayOrder;
      }
      // 库里没有时继续查本地镜像（旧逻辑曾只写文件）
    } catch (e) {
      console.error('pg findOrderByOutTradeNo', e);
    }
  }
  const db = await loadDb();
  return db.orders.find((o) => o.outTradeNo === no) || null;
}

/** 用户当前未过期的待支付订单（防重复下单） */
export async function findActivePendingOrder(
  userId: string,
): Promise<PayOrder | null> {
  if (process.env.DATABASE_URL) {
    try {
      const pool = getPool();
      const now = Date.now();
      const res = await pool.query(
        `SELECT * FROM orders WHERE user_id=$1 AND status IN ('pending','user_paying') AND expire_at>$2 AND code_url IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
        [userId, now],
      );
      if (res.rows?.length) {
        const r = res.rows[0];
        return {
          id: r.id,
          outTradeNo: r.out_trade_no,
          userId: r.user_id,
          amountFen: Number(r.amount_fen),
          amountYuan: Number(r.amount_yuan),
          message: r.message,
          status: r.status,
          codeUrl: r.code_url,
          expireAt: Number(r.expire_at || 0),
          createdAt: epochMs(r.created_at) || 0,
          updatedAt: epochMs(r.updated_at) || 0,
          transactionId: r.transaction_id || undefined,
          paidAt: epochMs(r.paid_at),
          payerOpenid: r.payer_openid || undefined,
        } as PayOrder;
      }
    } catch (e) {
      console.error('pg findActivePendingOrder', e);
    }
  }
  const db = await loadDb();
  const now = Date.now();
  const open = db.orders
    .filter(
      (o) =>
        o.userId === userId &&
        isOpenStatus(o.status) &&
        o.expireAt > now &&
        o.codeUrl,
    )
    .sort((a, b) => b.createdAt - a.createdAt);
  return open[0] || null;
}

export async function createPayOrder(input: {
  userId: string;
  amountFen: number;
  amountYuan: number;
  message: string;
  codeUrl: string;
  expireAt: number;
  outTradeNo?: string;
}): Promise<PayOrder> {
  const now = Date.now();
  const order: PayOrder = {
    id: uid('ord'),
    outTradeNo: input.outTradeNo || newOutTradeNo(),
    userId: input.userId,
    amountFen: input.amountFen,
    amountYuan: input.amountYuan,
    message: (input.message || '').trim().slice(0, 120),
    status: 'pending',
    codeUrl: input.codeUrl,
    expireAt: input.expireAt,
    createdAt: now,
    updatedAt: now,
  };

  // 写入 Postgres（id 交给数据库默认，避免 UUID/TEXT 类型与 ord_xxx 冲突）
  if (process.env.DATABASE_URL) {
    try {
      const pool = getPool();
      const res = await pool.query(
        `INSERT INTO orders (out_trade_no, user_id, amount_fen, amount_yuan, status, message, code_url, expire_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (out_trade_no) DO UPDATE SET
           code_url=EXCLUDED.code_url,
           expire_at=EXCLUDED.expire_at,
           message=EXCLUDED.message,
           amount_fen=EXCLUDED.amount_fen,
           amount_yuan=EXCLUDED.amount_yuan,
           status=CASE
             WHEN orders.status = 'paid' THEN orders.status
             ELSE EXCLUDED.status
           END,
           updated_at=EXCLUDED.updated_at
         RETURNING id`,
        [
          order.outTradeNo,
          order.userId,
          order.amountFen,
          order.amountYuan,
          order.status,
          order.message,
          order.codeUrl,
          order.expireAt,
          order.createdAt,
          order.updatedAt,
        ],
      );
      if (res.rows?.[0]?.id) {
        order.id = String(res.rows[0].id);
      }
    } catch (e) {
      // 不阻断下单：本地文件仍可支撑回调/轮询；履约时再 upsert 入库
      console.error(
        '[pay] createPayOrder pg insert failed（将仅写本地订单镜像）',
        e,
      );
    }
  }

  try {
    const db = await loadDb();
    const idx = db.orders.findIndex((o) => o.outTradeNo === order.outTradeNo);
    if (idx >= 0) db.orders[idx] = order;
    else db.orders.unshift(order);
    if (db.orders.length > 2000) db.orders.length = 2000;
    await saveDb(db);
  } catch (e) {
    console.error('[pay] createPayOrder file mirror', e);
  }
  return order;
}

export async function updatePayOrder(
  outTradeNo: string,
  patch: Partial<
    Pick<
      PayOrder,
      | 'status'
      | 'codeUrl'
      | 'expireAt'
      | 'transactionId'
      | 'paidAt'
      | 'payerOpenid'
      | 'message'
      | 'amountFen'
      | 'amountYuan'
    >
  >,
): Promise<PayOrder | null> {
  if (process.env.DATABASE_URL) {
    try {
      const pool = getPool();
      const fields: string[] = [];
      const vals: any[] = [];
      let i = 1;
      for (const [k, v] of Object.entries(patch)) {
        if (k === 'codeUrl') {
          fields.push(`code_url=$${i++}`);
          vals.push(v);
        } else if (k === 'transactionId') {
          fields.push(`transaction_id=$${i++}`);
          vals.push(v);
        } else if (k === 'payerOpenid') {
          fields.push(`payer_openid=$${i++}`);
          vals.push(v);
        } else if (k === 'paidAt') {
          fields.push(`paid_at=$${i++}`);
          vals.push(v);
        } else if (k === 'expireAt') {
          fields.push(`expire_at=$${i++}`);
          vals.push(v);
        } else if (k === 'message') {
          fields.push(`message=$${i++}`);
          vals.push(v);
        } else if (k === 'status') {
          fields.push(`status=$${i++}`);
          vals.push(v);
        } else if (k === 'amountFen') {
          fields.push(`amount_fen=$${i++}`);
          vals.push(v);
        } else if (k === 'amountYuan') {
          fields.push(`amount_yuan=$${i++}`);
          vals.push(v);
        }
      }
      if (fields.length === 0) return null;
      fields.push(`updated_at=$${i++}`);
      vals.push(Date.now());
      const sql = `UPDATE orders SET ${fields.join(', ')} WHERE out_trade_no=$${i} RETURNING *`;
      vals.push(outTradeNo);
      const res = await pool.query(sql, vals);
      if (!res.rows || res.rows.length === 0) {
        // If there is no row updated, the order may not exist in Postgres because
        // we defer insertion until payment. Load the order from blob/file store
        // and insert it now with applied patch (only when patch contains paid status or transaction).
        try {
          const localDb = await loadDb();
          const existing = localDb.orders.find((o) => o.outTradeNo === outTradeNo);
          if (!existing) return null;
          const next = { ...existing, ...patch, updatedAt: Date.now() } as PayOrder;
          // insert into Postgres
          await pool.query(
            `INSERT INTO orders (id, out_trade_no, user_id, amount_fen, amount_yuan, status, message, code_url, expire_at, created_at, updated_at, transaction_id, paid_at, payer_openid)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
            [
              next.id,
              next.outTradeNo,
              next.userId,
              next.amountFen,
              next.amountYuan,
              next.status,
              next.message,
              next.codeUrl,
              next.expireAt,
              next.createdAt,
              next.updatedAt,
              next.transactionId || null,
              next.paidAt || null,
              next.payerOpenid || null,
            ],
          );
          return next;
        } catch (ie) {
          console.error('pg insert-on-update missing row failed', ie);
          // fallback to file handling below
        }
      }
      const r = res.rows[0];
      return {
        id: r.id,
        outTradeNo: r.out_trade_no,
        userId: r.user_id,
        amountFen: Number(r.amount_fen),
        amountYuan: Number(r.amount_yuan),
        message: r.message,
        status: r.status,
        codeUrl: r.code_url,
        expireAt: Number(r.expire_at || 0),
        createdAt: epochMs(r.created_at) || 0,
        updatedAt: epochMs(r.updated_at) || 0,
        transactionId: r.transaction_id || undefined,
        paidAt: epochMs(r.paid_at),
        payerOpenid: r.payer_openid || undefined,
      } as PayOrder;
    } catch (e) {
      console.error('pg updatePayOrder', e);
    }
  }

  const db = await loadDb();
  const idx = db.orders.findIndex((o) => o.outTradeNo === outTradeNo);
  if (idx < 0) return null;
  const next = {
    ...db.orders[idx],
    ...patch,
    updatedAt: Date.now(),
  };
  db.orders[idx] = next;
  await saveDb(db);
  return next;
}

/** 关闭用户其他未完成订单（刷新二维码时防多单） */
export async function closeOpenOrdersForUser(
  userId: string,
  exceptOutTradeNo?: string,
): Promise<PayOrder[]> {
  const closed: PayOrder[] = [];
  const now = Date.now();

  if (process.env.DATABASE_URL) {
    try {
      const pool = getPool();
      const res = await pool.query(
        `UPDATE orders SET status='closed', updated_at=$1 WHERE user_id=$2 AND status IN ('pending','user_paying') ${exceptOutTradeNo ? `AND out_trade_no<>$3` : ''} RETURNING *`,
        exceptOutTradeNo ? [now, userId, exceptOutTradeNo] : [now, userId],
      );
      for (const r of res.rows || []) {
        closed.push({
          id: r.id,
          outTradeNo: r.out_trade_no,
          userId: r.user_id,
          amountFen: Number(r.amount_fen),
          amountYuan: Number(r.amount_yuan),
          message: r.message,
          status: r.status,
          codeUrl: r.code_url,
          expireAt: Number(r.expire_at || 0),
          createdAt: epochMs(r.created_at) || 0,
          updatedAt: epochMs(r.updated_at) || 0,
          transactionId: r.transaction_id || undefined,
          paidAt: epochMs(r.paid_at),
          payerOpenid: r.payer_openid || undefined,
        } as PayOrder);
      }
    } catch (e) {
      console.error('pg closeOpenOrdersForUser', e);
    }
  }

  // 同步关闭本地镜像，避免「库关了、文件里还是 pending」
  try {
    const db = await loadDb();
    let dirty = false;
    for (let i = 0; i < db.orders.length; i++) {
      const o = db.orders[i];
      if (o.userId !== userId) continue;
      if (exceptOutTradeNo && o.outTradeNo === exceptOutTradeNo) continue;
      if (!isOpenStatus(o.status)) continue;
      const next = { ...o, status: 'closed' as const, updatedAt: now };
      db.orders[i] = next;
      dirty = true;
      if (!closed.some((c) => c.outTradeNo === next.outTradeNo)) {
        closed.push(next);
      }
    }
    if (dirty) await saveDb(db);
  } catch (e) {
    console.error('file closeOpenOrdersForUser', e);
  }
  return closed;
}

export async function markOrderExpiredIfNeeded(
  order: PayOrder,
): Promise<PayOrder> {
  if (!isOpenStatus(order.status)) return order;
  if (order.expireAt > Date.now()) return order;
  const updated = await updatePayOrder(order.outTradeNo, { status: 'expired' });
  return updated || { ...order, status: 'expired' };
}

/** 用户已支付订单（打赏记录 / 累计） */
export async function listPaidOrdersByUser(
  userId: string,
): Promise<PayOrder[]> {
  if (!userId) return [];
  const byNo = new Map<string, PayOrder>();

  if (process.env.DATABASE_URL) {
    try {
      const pool = getPool();
      const res = await pool.query(
        `SELECT * FROM orders WHERE user_id=$1 AND status='paid' ORDER BY COALESCE(paid_at, created_at) DESC`,
        [userId],
      );
      for (const r of res.rows || []) {
        byNo.set(r.out_trade_no, {
          id: r.id,
          outTradeNo: r.out_trade_no,
          userId: r.user_id,
          amountFen: Number(r.amount_fen),
          amountYuan: Number(r.amount_yuan),
          message: r.message,
          status: 'paid',
          codeUrl: r.code_url,
          expireAt: Number(r.expire_at || 0),
          createdAt: epochMs(r.created_at) || 0,
          updatedAt: epochMs(r.updated_at) || 0,
          transactionId: r.transaction_id || undefined,
          paidAt: epochMs(r.paid_at),
          payerOpenid: r.payer_openid || undefined,
        } as PayOrder);
      }
    } catch (e) {
      console.error('pg listPaidOrdersByUser', e);
    }
  }

  try {
    const db = await loadDb();
    for (const o of db.orders) {
      if (o.userId === userId && o.status === 'paid' && !byNo.has(o.outTradeNo)) {
        byNo.set(o.outTradeNo, o);
      }
    }
  } catch {
    /* ignore */
  }

  return [...byNo.values()].sort(
    (a, b) => (b.paidAt || b.createdAt) - (a.paidAt || a.createdAt),
  );
}
