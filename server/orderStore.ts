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

/** 用户当前未过期的待支付订单（防重复下单；待支付只存在本地镜像，不进 Postgres） */
export async function findActivePendingOrder(
  userId: string,
): Promise<PayOrder | null> {
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

  // 待支付不写 Postgres，只落本地镜像；支付成功时再由 fulfillPaidOrder 入库
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

/** 删除库里未支付成功的订单行（只保留 paid） */
export async function purgeUnpaidOrdersFromDb(): Promise<number> {
  if (!process.env.DATABASE_URL) return 0;
  try {
    const pool = getPool();
    const res = await pool.query(
      `DELETE FROM orders WHERE status IS DISTINCT FROM 'paid'`,
    );
    const n = res.rowCount || 0;
    if (n > 0) console.log('[pay] purged unpaid orders from db', n);
    return n;
  } catch (e) {
    console.error('[pay] purgeUnpaidOrdersFromDb', e);
    return 0;
  }
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
  const db = await loadDb();
  const idx = db.orders.findIndex((o) => o.outTradeNo === outTradeNo);
  if (idx < 0) return null;
  const next = {
    ...db.orders[idx],
    ...patch,
    updatedAt: Date.now(),
  } as PayOrder;
  db.orders[idx] = next;
  await saveDb(db);

  // Postgres：仅持久化支付成功；其它状态只留文件，并清掉误写入的未支付行
  if (process.env.DATABASE_URL) {
    try {
      const pool = getPool();
      if (next.status === 'paid') {
        await pool.query(
          `INSERT INTO orders (out_trade_no, user_id, amount_fen, amount_yuan, status, message, code_url, expire_at, created_at, updated_at, transaction_id, paid_at, payer_openid)
           VALUES ($1,$2,$3,$4,'paid',$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (out_trade_no) DO UPDATE SET
             status='paid',
             message=EXCLUDED.message,
             amount_fen=EXCLUDED.amount_fen,
             amount_yuan=EXCLUDED.amount_yuan,
             transaction_id=COALESCE(EXCLUDED.transaction_id, orders.transaction_id),
             paid_at=COALESCE(EXCLUDED.paid_at, orders.paid_at),
             payer_openid=COALESCE(EXCLUDED.payer_openid, orders.payer_openid),
             updated_at=EXCLUDED.updated_at`,
          [
            next.outTradeNo,
            next.userId,
            next.amountFen,
            next.amountYuan,
            next.message || null,
            next.codeUrl || null,
            next.expireAt,
            next.createdAt,
            next.updatedAt,
            next.transactionId || null,
            next.paidAt || null,
            next.payerOpenid || null,
          ],
        );
      } else {
        await pool.query(
          `DELETE FROM orders WHERE out_trade_no=$1 AND status IS DISTINCT FROM 'paid'`,
          [outTradeNo],
        );
      }
    } catch (e) {
      console.error('pg updatePayOrder', e);
    }
  }

  return next;
}

/** 关闭用户其他未完成订单（刷新二维码时防多单） */
export async function closeOpenOrdersForUser(
  userId: string,
  exceptOutTradeNo?: string,
): Promise<PayOrder[]> {
  const closed: PayOrder[] = [];
  const now = Date.now();

  // 库中不应再有 pending；顺手清掉历史未支付行
  if (process.env.DATABASE_URL) {
    try {
      const pool = getPool();
      await pool.query(
        `DELETE FROM orders WHERE user_id=$1 AND status IS DISTINCT FROM 'paid' ${
          exceptOutTradeNo ? 'AND out_trade_no<>$2' : ''
        }`,
        exceptOutTradeNo ? [userId, exceptOutTradeNo] : [userId],
      );
    } catch (e) {
      console.error('pg closeOpenOrdersForUser purge', e);
    }
  }

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
      closed.push(next);
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
