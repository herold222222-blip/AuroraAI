import { toPublicUser, type UserRole } from './authTypes';
import { verifyToken, type AuthTokenPayload } from './authTokens';
import { getPool } from './db';
import {
  closeOpenOrdersForUser,
  createPayOrder,
  findActivePendingOrder,
  findOrderByOutTradeNo,
  listPaidOrdersByUser,
  markOrderExpiredIfNeeded,
  newOutTradeNo,
  updatePayOrder,
  type PayOrder,
} from './orderStore';
import { addSponsorship, ensurePayBookUser, findById } from './userStore';
import {
  closeOutTradeNo,
  createNativeOrder,
  decryptNotifyResource,
  getWechatPayConfig,
  queryByOutTradeNo,
  verifyWechatNotifySignature,
} from './wechatPay';

export type PayResult = {
  status: number;
  body: Record<string, unknown>;
  /** 微信支付回调需返回纯文本 */
  rawBody?: string;
  contentType?: string;
};

function ok(body: Record<string, unknown>, status = 200): PayResult {
  return { status, body };
}

function fail(error: string, status = 400): PayResult {
  return { status, body: { error } };
}

function bearerFromHeader(
  headers: Record<string, string | string[] | undefined>,
): string {
  const h = headers.authorization ?? headers.Authorization;
  const token = Array.isArray(h) ? h[0] : h;
  return token || '';
}

function authFromHeader(
  headers: Record<string, string | string[] | undefined>,
) {
  return verifyToken(bearerFromHeader(headers));
}

/** 本地 JWT 校验失败时，用线上 /api/auth/me 认登录态（混合代理联调） */
async function resolvePayAuth(
  headers: Record<string, string | string[] | undefined>,
): Promise<AuthTokenPayload | null> {
  const local = authFromHeader(headers);
  if (local) return local;

  const remote = String(
    process.env.AUTH_API_ORIGIN || process.env.VITE_API_ORIGIN || '',
  ).replace(/\/$/, '');
  if (!remote) return null;

  const token = bearerFromHeader(headers);
  if (!token) return null;
  const authorization = token.startsWith('Bearer ')
    ? token
    : `Bearer ${token}`;

  try {
    const res = await fetch(`${remote}/api/auth/me`, {
      headers: { Authorization: authorization },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      user?: {
        id?: string;
        username?: string;
        nickname?: string;
        role?: UserRole;
        avatar?: string;
      };
    };
    const u = data.user;
    if (!u?.id || !u.username) return null;
    await ensurePayBookUser({
      id: u.id,
      username: u.username,
      nickname: u.nickname,
      role: u.role,
      avatar: u.avatar,
    });
    return {
      sub: u.id,
      username: u.username,
      role: u.role === 'admin' ? 'admin' : 'user',
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
  } catch (err) {
    console.error('[pay] remote auth', err);
    return null;
  }
}

function headerGet(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) {
      return Array.isArray(v) ? v[0] || '' : v || '';
    }
  }
  return '';
}

/** 金额仅由服务端校验与入库，不信任前端展示数字 */
export function validateDonateAmountYuan(raw: unknown): {
  amountYuan: number;
  amountFen: number;
} {
  const minYuan = Number(process.env.DONATE_MIN_YUAN || 0.01);
  const maxYuan = Number(process.env.DONATE_MAX_YUAN || 99999);
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error('赞赏金额无效');
  }
  // 先转分再回算，避免浮点篡改
  const fen = Math.round(n * 100);
  if (!Number.isInteger(fen) || fen < 1) {
    throw new Error('赞赏金额无效');
  }
  const yuan = fen / 100;
  if (yuan < minYuan || yuan > maxYuan) {
    throw new Error(`赞赏金额需在 ¥${minYuan} ~ ¥${maxYuan} 之间`);
  }
  return { amountYuan: yuan, amountFen: fen };
}

function qrTtlMs(): number {
  const sec = Number(process.env.WECHAT_PAY_QR_TTL_SEC || 7200);
  const clamped = Number.isFinite(sec) ? Math.min(Math.max(sec, 60), 7200) : 7200;
  return clamped * 1000;
}

function pollMaxMs(): number {
  const ms = Number(process.env.DONATE_POLL_MAX_MS || 300_000);
  return Number.isFinite(ms) && ms > 0 ? ms : 300_000;
}

function publicOrder(order: PayOrder) {
  return {
    outTradeNo: order.outTradeNo,
    amount: order.amountYuan,
    amountFen: order.amountFen,
    message: order.message || '',
    status: order.status,
    codeUrl: order.codeUrl,
    expireAt: order.expireAt,
    createdAt: order.createdAt,
    paidAt: order.paidAt || null,
    transactionId: order.transactionId || null,
    pollIntervalMs: 2500,
    pollMaxMs: pollMaxMs(),
    channel: 'wechat' as const,
  };
}

async function fulfillPaidOrder(
  order: PayOrder,
  info: {
    transactionId: string;
    amountTotal: number;
    payerOpenid?: string;
  },
): Promise<PayOrder> {
  if (order.status === 'paid') {
    return order;
  }
  // 后端二次校验金额：必须以订单入库金额为准
  if (info.amountTotal !== order.amountFen) {
    throw new Error(
      `支付金额与订单不符（期望 ${order.amountFen} 分，实际 ${info.amountTotal} 分）`,
    );
  }
  const paidAt = Date.now();

  if (process.env.DATABASE_URL) {
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const sel = await client.query(
        'SELECT * FROM orders WHERE out_trade_no=$1 FOR UPDATE',
        [order.outTradeNo],
      );

      let row = sel.rows?.[0];
      if (row?.status === 'paid') {
        await client.query('COMMIT');
        return {
          id: row.id,
          outTradeNo: row.out_trade_no,
          userId: row.user_id,
          amountFen: Number(row.amount_fen),
          amountYuan: Number(row.amount_yuan),
          message: row.message || '',
          status: 'paid',
          codeUrl: row.code_url,
          expireAt: Number(row.expire_at || 0),
          createdAt: Number(row.created_at || 0),
          updatedAt: Number(row.updated_at || 0),
          transactionId: row.transaction_id || undefined,
          paidAt: row.paid_at || undefined,
          payerOpenid: row.payer_openid || undefined,
        } as PayOrder;
      }

      if (!row) {
        // 历史：下单只写了本地文件，履约时补插入库
        await client.query(
          `INSERT INTO orders (out_trade_no, user_id, amount_fen, amount_yuan, status, message, code_url, expire_at, created_at, updated_at, transaction_id, paid_at, payer_openid)
           VALUES ($1,$2,$3,$4,'paid',$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (out_trade_no) DO UPDATE SET
             status='paid',
             transaction_id=EXCLUDED.transaction_id,
             paid_at=EXCLUDED.paid_at,
             payer_openid=EXCLUDED.payer_openid,
             updated_at=EXCLUDED.updated_at`,
          [
            order.outTradeNo,
            order.userId,
            order.amountFen,
            order.amountYuan,
            order.message || null,
            order.codeUrl || null,
            order.expireAt,
            order.createdAt,
            paidAt,
            info.transactionId || null,
            paidAt,
            info.payerOpenid || null,
          ],
        );
      } else {
        await client.query(
          `UPDATE orders SET status='paid', transaction_id=$1, paid_at=$2, payer_openid=$3, updated_at=$4 WHERE out_trade_no=$5`,
          [
            info.transactionId,
            paidAt,
            info.payerOpenid || null,
            paidAt,
            order.outTradeNo,
          ],
        );
      }

      const ps = await client.query(
        'SELECT id FROM sponsorships WHERE out_trade_no=$1',
        [order.outTradeNo],
      );
      if (!ps.rowCount) {
        await client.query(
          `INSERT INTO sponsorships (sponsor_id, target_user_id, amount_cents, message, out_trade_no, transaction_id, pay_channel, paid_at, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,'wechat',$7,$7)`,
          [
            order.userId,
            order.userId,
            order.amountFen,
            order.message || null,
            order.outTradeNo,
            info.transactionId || null,
            paidAt,
          ],
        );
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('[pay] fulfillPaidOrder tx', e);
      throw e;
    } finally {
      client.release();
    }

    // 同步 users.sponsorships JSON，供旧读路径 / 管理端留言用
    try {
      await addSponsorship(order.userId, order.amountYuan, order.message || '', {
        outTradeNo: order.outTradeNo,
        transactionId: info.transactionId,
        payChannel: 'wechat',
        paidAt,
      });
    } catch (e) {
      console.error('[pay] addSponsorship mirror', e);
    }

    // 刷新本地文件镜像
    try {
      await updatePayOrder(order.outTradeNo, {
        status: 'paid',
        transactionId: info.transactionId,
        paidAt,
        payerOpenid: info.payerOpenid,
      });
    } catch {
      /* ignore */
    }

    const paid = await findOrderByOutTradeNo(order.outTradeNo);
    return (
      paid ||
      ({
        ...order,
        status: 'paid',
        transactionId: info.transactionId,
        paidAt,
        payerOpenid: info.payerOpenid,
      } as PayOrder)
    );
  }

  // Fallback: file-based operations
  const updated =
    (await updatePayOrder(order.outTradeNo, {
      status: 'paid',
      transactionId: info.transactionId,
      paidAt,
      payerOpenid: info.payerOpenid,
    })) || order;

  await addSponsorship(order.userId, order.amountYuan, order.message, {
    outTradeNo: order.outTradeNo,
    transactionId: info.transactionId,
    payChannel: 'wechat',
    paidAt,
  });
  return updated;
}

async function syncOrderWithWechat(order: PayOrder): Promise<PayOrder> {
  let current = await markOrderExpiredIfNeeded(order);
  if (current.status === 'paid' || current.status === 'closed') return current;
  if (current.status === 'expired') return current;

  try {
    const q = await queryByOutTradeNo(current.outTradeNo);
    console.log('[pay] query', current.outTradeNo, q.tradeState);
    if (q.tradeState === 'SUCCESS') {
      return fulfillPaidOrder(current, {
        transactionId: q.transactionId || '',
        amountTotal: q.amountTotal ?? current.amountFen,
        payerOpenid: q.payerOpenid,
      });
    }
    if (q.tradeState === 'USERPAYING') {
      const u = await updatePayOrder(current.outTradeNo, {
        status: 'user_paying',
      });
      return u || { ...current, status: 'user_paying' };
    }
    if (
      q.tradeState === 'CLOSED' ||
      q.tradeState === 'REVOKED' ||
      q.tradeState === 'PAYERROR'
    ) {
      const u = await updatePayOrder(current.outTradeNo, { status: 'closed' });
      return u || { ...current, status: 'closed' };
    }
  } catch (err) {
    console.error(
      '[pay] query order failed（轮询无法确认支付；请检查代理/微信API连通）',
      current.outTradeNo,
      err,
    );
  }
  return current;
}

export async function handleCreateDonateOrder(
  body: { amount?: unknown; message?: string; refresh?: boolean },
  headers: Record<string, string | string[] | undefined>,
): Promise<PayResult> {
  const payload = await resolvePayAuth(headers);
  if (!payload) return fail('请先登录后再赞赏', 401);
  if (!getWechatPayConfig()) {
    return fail('微信支付未配置，请联系管理员', 503);
  }

  try {
    const { amountYuan, amountFen } = validateDonateAmountYuan(body.amount);
    const message = String(body.message || '')
      .trim()
      .slice(0, 120);
    const refresh = Boolean(body.refresh);

    if (!refresh) {
      const existing = await findActivePendingOrder(payload.sub);
      if (existing) {
        const synced = await syncOrderWithWechat(existing);
        // 历史单已付清：只入账，不把「已支付」当作本次下单结果（否则前端会未扫码就成功）
        if (synced.status === 'paid') {
          console.log(
            '[pay] create: prior pending already paid, issue new QR',
            synced.outTradeNo,
          );
        } else if (
          (synced.status === 'pending' || synced.status === 'user_paying') &&
          synced.amountFen === amountFen
        ) {
          let order = synced;
          if (message !== synced.message) {
            order =
              (await updatePayOrder(synced.outTradeNo, { message })) || synced;
          }
          return ok({ order: publicOrder(order), reused: true });
        }
      }
    }

    // 换金额 / 强制刷新：先向微信同步旧单（避免已付款被误关），再关单重下
    const existingOpen = await findActivePendingOrder(payload.sub);
    if (existingOpen) {
      const syncedOld = await syncOrderWithWechat(existingOpen);
      if (syncedOld.status === 'paid') {
        console.log(
          '[pay] create: open order already paid before close',
          syncedOld.outTradeNo,
        );
      }
    }

    const oldOpen = await closeOpenOrdersForUser(payload.sub);
    for (const o of oldOpen) {
      // 关单前再查一次，已支付则履约而不是关掉
      try {
        const q = await queryByOutTradeNo(o.outTradeNo);
        if (q.tradeState === 'SUCCESS') {
          await fulfillPaidOrder(o, {
            transactionId: q.transactionId || '',
            amountTotal: q.amountTotal ?? o.amountFen,
            payerOpenid: q.payerOpenid,
          });
          continue;
        }
      } catch (e) {
        console.warn('[pay] sync-before-close', o.outTradeNo, e);
      }
      void closeOutTradeNo(o.outTradeNo);
    }

    const outTradeNo = newOutTradeNo();
    const expireAt = Date.now() + qrTtlMs();
    const { codeUrl } = await createNativeOrder({
      outTradeNo,
      description: 'Aurora 赞赏',
      amountFen,
      expireAt,
      attach: payload.sub.slice(0, 128),
    });

    const order = await createPayOrder({
      userId: payload.sub,
      amountFen,
      amountYuan,
      message,
      codeUrl,
      expireAt,
      outTradeNo,
    });

    // 创建接口只返回待支付单；支付成功只由回调 / 状态轮询确认
    return ok({ order: publicOrder(order), reused: false }, 201);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

export async function handleGetPendingDonateOrder(
  headers: Record<string, string | string[] | undefined>,
): Promise<PayResult> {
  const payload = await resolvePayAuth(headers);
  if (!payload) return fail('请先登录后再赞赏', 401);
  const existing = await findActivePendingOrder(payload.sub);
  if (!existing) return ok({ order: null });
  const synced = await syncOrderWithWechat(existing);
  if (synced.status !== 'pending' && synced.status !== 'user_paying') {
    return ok({ order: null });
  }
  return ok({ order: publicOrder(synced) });
}

/** 我的钱包：已支付打赏订单 + 累计金额 */
export async function handleListMyDonateRecords(
  headers: Record<string, string | string[] | undefined>,
): Promise<PayResult> {
  const payload = await resolvePayAuth(headers);
  if (!payload) return fail('请先登录', 401);

  try {
    const paidOrders = await listPaidOrdersByUser(payload.sub);
    const user = await findById(payload.sub);
    const seen = new Set<string>();

    type Row = {
      id: string;
      amount: number;
      message: string;
      createdAt: number;
      paidAt: number;
      outTradeNo?: string;
      transactionId?: string;
      payChannel: 'wechat';
      status: 'paid';
    };

    const records: Row[] = [];

    for (const o of paidOrders) {
      seen.add(o.outTradeNo);
      const paidAt = o.paidAt || o.createdAt;
      records.push({
        id: o.id,
        amount: o.amountYuan,
        message: o.message || '',
        createdAt: paidAt,
        paidAt,
        outTradeNo: o.outTradeNo,
        transactionId: o.transactionId,
        payChannel: 'wechat',
        status: 'paid',
      });
    }

    // sponsorships 表（履约主写入）；补齐仅有表记录、订单状态异常的情况
    if (process.env.DATABASE_URL) {
      try {
        const pool = getPool();
        const sp = await pool.query(
          `SELECT id, amount_cents, message, out_trade_no, transaction_id, paid_at, created_at
           FROM sponsorships
           WHERE sponsor_id=$1
           ORDER BY COALESCE(paid_at, created_at) DESC`,
          [payload.sub],
        );
        for (const r of sp.rows || []) {
          const no = r.out_trade_no ? String(r.out_trade_no) : '';
          if (no && seen.has(no)) continue;
          if (no) seen.add(no);
          const paidAt = Number(r.paid_at || r.created_at || Date.now());
          const cents = Number(r.amount_cents || 0);
          records.push({
            id: String(r.id),
            amount: Math.round(cents) / 100,
            message: r.message || '',
            createdAt: paidAt,
            paidAt,
            outTradeNo: no || undefined,
            transactionId: r.transaction_id || undefined,
            payChannel: 'wechat',
            status: 'paid',
          });
        }
      } catch (e) {
        console.error('[pay] list sponsorships', e);
      }
    }

    // 兼容仅有 users.sponsorships JSON、无订单快照的历史记录
    for (const s of user?.sponsorships || []) {
      if (s.outTradeNo && seen.has(s.outTradeNo)) continue;
      if (s.outTradeNo) seen.add(s.outTradeNo);
      const paidAt = s.paidAt || s.createdAt;
      records.push({
        id: s.id,
        amount: s.amount,
        message: s.message || '',
        createdAt: paidAt,
        paidAt,
        outTradeNo: s.outTradeNo,
        transactionId: s.transactionId,
        payChannel: 'wechat',
        status: 'paid',
      });
    }

    records.sort((a, b) => b.paidAt - a.paidAt);
    const total =
      Math.round(records.reduce((sum, r) => sum + (Number(r.amount) || 0), 0) * 100) /
      100;

    return ok({
      records,
      total,
      count: records.length,
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

/** 仅更新待支付单留言（不换码、不重新下单） */
export async function handleUpdateDonateOrderMessage(
  body: { outTradeNo?: string; message?: string },
  headers: Record<string, string | string[] | undefined>,
): Promise<PayResult> {
  const payload = await resolvePayAuth(headers);
  if (!payload) return fail('请先登录后再赞赏', 401);
  const no = String(body.outTradeNo || '').trim();
  if (!no) return fail('订单号无效');
  const order = await findOrderByOutTradeNo(no);
  if (!order) return fail('订单不存在', 404);
  if (order.userId !== payload.sub) return fail('无权操作该订单', 403);
  if (order.status !== 'pending' && order.status !== 'user_paying') {
    return fail('订单已结束，无法修改留言');
  }
  const message = String(body.message || '')
    .trim()
    .slice(0, 120);
  const updated = await updatePayOrder(no, { message });
  return ok({ order: publicOrder(updated || { ...order, message }) });
}

export async function handleDonateOrderStatus(
  outTradeNo: string,
  headers: Record<string, string | string[] | undefined>,
): Promise<PayResult> {
  const payload = await resolvePayAuth(headers);
  if (!payload) return fail('请先登录后再赞赏', 401);
  const no = decodeURIComponent(outTradeNo || '').trim();
  if (!no) return fail('订单号无效');

  let order = await findOrderByOutTradeNo(no);
  // 库/文件都丢了时：凭商户单号查微信，SUCCESS 则按 attach=userId 重建并履约
  if (!order) {
    try {
      const q = await queryByOutTradeNo(no);
      console.log('[pay] status recover query', no, q.tradeState, q.attach || '');
      if (q.tradeState !== 'SUCCESS') {
        return fail('订单不存在', 404);
      }
      const attachUser = String(q.attach || '').trim();
      if (attachUser && attachUser !== payload.sub) {
        return fail('无权查看该订单', 403);
      }
      if (!attachUser) {
        // 旧单无 attach：仅允许当前登录用户主动认领已付款单
        console.warn('[pay] status recover without attach', no, payload.sub);
      }
      const amountFen = q.amountTotal && q.amountTotal > 0 ? q.amountTotal : 0;
      if (amountFen < 1) return fail('订单金额无效', 400);
      order = await createPayOrder({
        userId: payload.sub,
        amountFen,
        amountYuan: Math.round(amountFen) / 100,
        message: '',
        codeUrl: '',
        expireAt: Date.now() + 60_000,
        outTradeNo: no,
      });
      const paid = await fulfillPaidOrder(order, {
        transactionId: q.transactionId || '',
        amountTotal: amountFen,
        payerOpenid: q.payerOpenid,
      });
      const u = await findById(payload.sub);
      return ok({
        order: publicOrder(paid),
        user: u ? toPublicUser(u) : null,
      });
    } catch (err) {
      console.error('[pay] status recover failed', no, err);
      return fail('订单不存在', 404);
    }
  }
  if (order.userId !== payload.sub) return fail('无权查看该订单', 403);

  try {
    const synced = await syncOrderWithWechat(order);
    let user = null;
    if (synced.status === 'paid') {
      const u = await findById(payload.sub);
      if (u) user = toPublicUser(u);
    }
    return ok({ order: publicOrder(synced), user });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

export async function handleWechatPayNotify(
  rawBody: string,
  headers: Record<string, string | string[] | undefined>,
): Promise<PayResult> {
  const failWx = (message: string) => ({
    status: 500,
    body: {},
    rawBody: JSON.stringify({ code: 'FAIL', message }),
    contentType: 'application/json',
  });
  const okWx = (): PayResult => ({
    status: 200,
    body: {},
    rawBody: JSON.stringify({ code: 'SUCCESS', message: '成功' }),
    contentType: 'application/json',
  });

  try {
    if (!getWechatPayConfig()) {
      return failWx('未配置');
    }
    const verified = await verifyWechatNotifySignature(
      {
        timestamp: headerGet(headers, 'wechatpay-timestamp'),
        nonce: headerGet(headers, 'wechatpay-nonce'),
        signature: headerGet(headers, 'wechatpay-signature'),
        serial: headerGet(headers, 'wechatpay-serial'),
      },
      rawBody,
    );
    if (!verified) {
      console.error('[pay] notify signature failed', {
        serial: headerGet(headers, 'wechatpay-serial'),
        hasTs: Boolean(headerGet(headers, 'wechatpay-timestamp')),
        bodyLen: rawBody.length,
      });
      return failWx('签名校验失败');
    }

    const parsed = JSON.parse(rawBody) as {
      resource?: {
        algorithm?: string;
        ciphertext?: string;
        nonce?: string;
        associated_data?: string;
      };
    };
    const resource = decryptNotifyResource(parsed);
    console.log('[pay] notify decrypted', {
      outTradeNo: resource.outTradeNo,
      tradeState: resource.tradeState,
      transactionId: resource.transactionId,
      attach: resource.attach || '',
    });
    if (resource.tradeState && resource.tradeState !== 'SUCCESS') {
      return okWx();
    }

    let order = await findOrderByOutTradeNo(resource.outTradeNo);
    if (!order) {
      // 丢单恢复：下单时 attach=userId；本地/库均无记录时凭回调重建
      const userId = String(resource.attach || '').trim();
      if (!userId || resource.amountTotal < 1) {
        console.error('[pay] notify unknown order', resource.outTradeNo);
        return failWx('订单不存在');
      }
      console.warn('[pay] notify recover missing order', resource.outTradeNo, userId);
      const amountFen = resource.amountTotal;
      const amountYuan = Math.round(amountFen) / 100;
      order = await createPayOrder({
        userId,
        amountFen,
        amountYuan,
        message: '',
        codeUrl: '',
        expireAt: Date.now() + 60_000,
        outTradeNo: resource.outTradeNo,
      });
    }

    await fulfillPaidOrder(order, {
      transactionId: resource.transactionId,
      amountTotal: resource.amountTotal,
      payerOpenid: resource.payerOpenid,
    });
    console.log('[pay] notify fulfilled', resource.outTradeNo);
    return okWx();
  } catch (err) {
    console.error('[pay] notify', err);
    return failWx(err instanceof Error ? err.message : '处理失败');
  }
}
