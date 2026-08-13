import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

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
  return readFileDb();
}

async function saveDb(db: DbShape): Promise<void> {
  const usedBlob = await writeBlobDb(db);
  if (!usedBlob) await writeFileDb(db);
}

function isOpenStatus(s: PayOrderStatus): boolean {
  return s === 'pending' || s === 'user_paying';
}

export async function findOrderByOutTradeNo(
  outTradeNo: string,
): Promise<PayOrder | null> {
  const db = await loadDb();
  return db.orders.find((o) => o.outTradeNo === outTradeNo) || null;
}

/** 用户当前未过期的待支付订单（防重复下单） */
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
  const db = await loadDb();
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
  db.orders.unshift(order);
  // 保留最近 2000 单
  if (db.orders.length > 2000) db.orders.length = 2000;
  await saveDb(db);
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
  const db = await loadDb();
  const closed: PayOrder[] = [];
  const now = Date.now();
  for (let i = 0; i < db.orders.length; i++) {
    const o = db.orders[i];
    if (o.userId !== userId) continue;
    if (exceptOutTradeNo && o.outTradeNo === exceptOutTradeNo) continue;
    if (!isOpenStatus(o.status)) continue;
    const next = { ...o, status: 'closed' as const, updatedAt: now };
    db.orders[i] = next;
    closed.push(next);
  }
  if (closed.length) await saveDb(db);
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
  const db = await loadDb();
  return db.orders
    .filter((o) => o.userId === userId && o.status === 'paid')
    .sort(
      (a, b) =>
        (b.paidAt || b.createdAt) - (a.paidAt || a.createdAt),
    );
}
