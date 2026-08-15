import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  apiCreateDonateOrder,
  apiDonateOrderStatus,
  apiGetPendingDonateOrder,
  apiUpdateDonateOrderMessage,
  type DonatePayOrder,
} from '../../api/authApi';
import { useAppStore } from '../../store/useAppStore';
import { useAuthStore } from '../../store/useAuthStore';

const PRESETS = [9.9, 28, 66, 128, 520] as const;
const AMOUNT_DEBOUNCE_MS = 450;
const MESSAGE_DEBOUNCE_MS = 600;

function formatAmount(n: number) {
  if (!Number.isFinite(n) || n <= 0) return '';
  return n % 1 === 0 ? String(n) : n.toFixed(2);
}

function amountFen(n: number) {
  return Math.round(n * 100);
}

function qrImageSrc(codeUrl: string) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=${encodeURIComponent(codeUrl)}`;
}

export function DonatePage({ onClose }: { onClose: () => void }) {
  const pushToast = useAppStore((s) => s.pushToast);
  const token = useAuthStore((s) => s.token);
  const requireAuth = useAuthStore((s) => s.requireAuth);
  const setUser = useAuthStore((s) => s.setUser);

  const [amountText, setAmountText] = useState('28');
  const [message, setMessage] = useState('');
  const [creating, setCreating] = useState(false);
  const [order, setOrder] = useState<DonatePayOrder | null>(null);
  const [pollHint, setPollHint] = useState('');
  const [ready, setReady] = useState(false);
  const [createError, setCreateError] = useState('');
  /** 外部二维码图片（qrserver）加载中 */
  const [qrImgLoading, setQrImgLoading] = useState(false);
  const [qrImgError, setQrImgError] = useState(false);

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollDeadlineRef = useRef<number>(0);
  const orderRef = useRef<DonatePayOrder | null>(null);
  const messageRef = useRef(message);
  const createSeqRef = useRef(0);

  const amount = Number.parseFloat(amountText);
  const valid = Number.isFinite(amount) && amount >= 0.01 && amount <= 99999;

  const qrExpired =
    !!order &&
    (order.status === 'expired' ||
      (order.expireAt > 0 && order.expireAt <= Date.now()));

  const stopPolling = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    pollDeadlineRef.current = 0;
  };

  useEffect(() => {
    orderRef.current = order;
  }, [order]);

  useEffect(() => {
    if (!order?.codeUrl || qrExpired) {
      setQrImgLoading(false);
      setQrImgError(false);
      return;
    }
    setQrImgLoading(true);
    setQrImgError(false);
  }, [order?.codeUrl, order?.outTradeNo, qrExpired]);

  useEffect(() => {
    messageRef.current = message;
  }, [message]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const clearAll = () => stopPolling();
    window.addEventListener('pagehide', clearAll);
    window.addEventListener('beforeunload', clearAll);
    return () => {
      clearAll();
      window.removeEventListener('pagehide', clearAll);
      window.removeEventListener('beforeunload', clearAll);
    };
  }, []);

  const startPolling = (next: DonatePayOrder) => {
    stopPolling();
    if (!token) return;
    if (next.status === 'paid' || next.status === 'closed') return;
    if (next.expireAt <= Date.now()) {
      setOrder({ ...next, status: 'expired' });
      setPollHint('二维码已过期，请切换金额或点击「刷新二维码」');
      return;
    }

    const interval = next.pollIntervalMs || 2500;
    const maxMs = next.pollMaxMs || 5 * 60 * 1000;
    pollDeadlineRef.current = Date.now() + maxMs;
    setPollHint('请使用微信扫码支付，支付完成后将自动确认');

    pollTimerRef.current = setInterval(() => {
      void (async () => {
        const current = orderRef.current;
        if (!current || !token) {
          stopPolling();
          return;
        }
        if (Date.now() > pollDeadlineRef.current) {
          stopPolling();
          setPollHint('等待支付超时（已停止轮询）。可刷新二维码后继续');
          return;
        }
        if (current.expireAt <= Date.now()) {
          stopPolling();
          setOrder((o) => (o ? { ...o, status: 'expired' } : o));
          setPollHint('二维码已过期，请切换金额或点击「刷新二维码」');
          return;
        }
        try {
          const { order: latest, user } = await apiDonateOrderStatus(
            token,
            current.outTradeNo,
          );
          setOrder(latest);
          if (latest.status === 'user_paying') {
            setPollHint('已扫码，等待付款确认…');
          } else if (latest.status === 'pending') {
            setPollHint('请使用微信扫码支付，支付完成后将自动确认');
          } else if (latest.status === 'paid') {
            stopPolling();
            if (user) setUser(user);
            const msg = String(latest.message || '').trim();
            pushToast(
              `感谢赞赏 ¥${formatAmount(latest.amount)}${
                msg ? '，留言已收到' : ''
              }`,
              'success',
            );
            onClose();
          } else if (
            latest.status === 'closed' ||
            latest.status === 'expired'
          ) {
            stopPolling();
            setPollHint(
              latest.status === 'expired'
                ? '二维码已过期，请切换金额或点击「刷新二维码」'
                : '订单已关闭，请刷新二维码',
            );
          }
        } catch (err) {
          console.warn('[donate] poll status', err);
        }
      })();
    }, interval);
  };

  const ensureOrder = async (opts: {
    yuan: number;
    msg: string;
    forceRefresh: boolean;
  }) => {
    if (!token) return;
    const seq = ++createSeqRef.current;
    setCreating(true);
    setCreateError('');
    stopPolling();
    try {
      const { order: next, user } = await apiCreateDonateOrder(
        token,
        opts.yuan,
        opts.msg,
        opts.forceRefresh,
      );
      if (seq !== createSeqRef.current) return;
      if (user) setUser(user);
      if (next.status === 'paid') {
        const msg = String(next.message || '').trim();
        pushToast(
          `感谢赞赏 ¥${formatAmount(next.amount)}${
            msg ? '，留言已收到' : ''
          }`,
          'success',
        );
        onClose();
        return;
      }
      setOrder(next);
      startPolling(next);
    } catch (err) {
      if (seq !== createSeqRef.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      setCreateError(msg);
      pushToast(msg, 'error');
    } finally {
      if (seq === createSeqRef.current) setCreating(false);
    }
  };

  // 进入页面：有未完成单则恢复，否则按默认金额自动下单出码
  useEffect(() => {
    if (!token) {
      setReady(true);
      return;
    }
    if (!requireAuth()) {
      setReady(true);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { order: pending } = await apiGetPendingDonateOrder(token);
        if (cancelled) return;
        if (pending) {
          setOrder(pending);
          setAmountText(formatAmount(pending.amount));
          setMessage(pending.message || '');
          startPolling(pending);
          setPollHint(
            pending.status === 'user_paying'
              ? '已扫码，等待付款确认…'
              : '已恢复未完成订单，请继续扫码支付',
          );
        } else {
          await ensureOrder({
            yuan: 28,
            msg: messageRef.current,
            forceRefresh: false,
          });
        }
      } catch {
        if (!cancelled) {
          await ensureOrder({
            yuan: 28,
            msg: messageRef.current,
            forceRefresh: false,
          });
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
      createSeqRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once
  }, [token]);

  // 金额变化：防抖后自动换单换码
  useEffect(() => {
    if (!ready || !token || !valid) return;

    const t = window.setTimeout(() => {
      const current = orderRef.current;
      const sameAmount =
        current &&
        amountFen(current.amount) === amountFen(amount) &&
        current.status !== 'expired' &&
        current.status !== 'closed' &&
        current.expireAt > Date.now();
      if (sameAmount) return;
      void ensureOrder({
        yuan: amount,
        msg: messageRef.current,
        forceRefresh: true,
      });
    }, AMOUNT_DEBOUNCE_MS);

    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- amount-driven
  }, [amountText, ready, token, valid]);

  // 留言变化：只更新订单留言，不换二维码
  useEffect(() => {
    if (!ready || !token || !orderRef.current) return;
    const outTradeNo = orderRef.current.outTradeNo;
    const t = window.setTimeout(() => {
      const current = orderRef.current;
      if (!current || current.outTradeNo !== outTradeNo) return;
      if ((current.message || '') === message) return;
      void apiUpdateDonateOrderMessage(token, outTradeNo, message)
        .then(({ order: next }) => {
          if (orderRef.current?.outTradeNo === next.outTradeNo) {
            setOrder(next);
          }
        })
        .catch(() => {
          // ignore
        });
    }, MESSAGE_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [message, ready, token]);

  const onRefreshQr = () => {
    if (!valid) {
      pushToast('请输入有效金额（最少 ¥0.01）', 'info');
      return;
    }
    if (!requireAuth() || !token) {
      pushToast('请先登录后再赞赏', 'info');
      return;
    }
    void ensureOrder({
      yuan: amount,
      msg: message,
      forceRefresh: true,
    });
  };

  const onConfirmPaid = () => {
    if (!token || !orderRef.current) {
      pushToast('暂无待确认订单', 'info');
      return;
    }
    const no = orderRef.current.outTradeNo;
    setPollHint('正在向微信确认支付结果…');
    void apiDonateOrderStatus(token, no)
      .then(({ order: latest, user }) => {
        setOrder(latest);
        if (latest.status === 'paid') {
          stopPolling();
          if (user) setUser(user);
          const msg = String(latest.message || '').trim();
          pushToast(
            `感谢赞赏 ¥${formatAmount(latest.amount)}${
              msg ? '，留言已收到' : ''
            }`,
            'success',
          );
          onClose();
          return;
        }
        setPollHint(
          latest.status === 'user_paying'
            ? '微信仍显示支付中，请稍后再点「我已完成支付」'
            : '微信尚未确认到账，请确认已支付成功后再试',
        );
        if (
          latest.status === 'pending' ||
          latest.status === 'user_paying'
        ) {
          startPolling(latest);
        }
      })
      .catch((err) => {
        const text = err instanceof Error ? err.message : String(err);
        setPollHint(`确认失败：${text}`);
        pushToast(text, 'error');
      });
  };

  const statusLabel = (() => {
    if (creating) return '正在生成收款码…';
    if (order?.codeUrl && !qrExpired && qrImgLoading) return '二维码加载中…';
    if (order?.codeUrl && qrImgError) return '二维码图片加载失败，请刷新';
    if (!order) {
      return createError ? '生成失败' : '仅支持微信扫码支付';
    }
    if (qrExpired || order.status === 'expired') return '二维码已过期';
    if (order.status === 'user_paying') return '已扫码等待付款';
    if (order.status === 'pending') return '待扫码支付';
    if (order.status === 'closed') return '订单已关闭';
    if (order.status === 'paid') return '支付成功';
    return '仅支持微信扫码支付';
  })();

  const showQrImg = Boolean(order?.codeUrl && !qrExpired && !creating);
  const showLoadingBox = creating || (showQrImg && qrImgLoading && !qrImgError);

  return createPortal(
    <div className="donate-page" data-auth-free role="dialog" aria-modal="true">
      <div className="donate-page-bg" aria-hidden />
      <header className="donate-page-head">
        <button type="button" className="btn ghost sm" onClick={onClose}>
          ← 返回
        </button>
        <div className="donate-page-titles">
          <h1>赞赏我们</h1>
          <p>选择金额即出码 · 微信扫码支付 · 可选留言</p>
        </div>
      </header>

      <main className="donate-page-main">
        <section className="donate-card donate-qr-card">
          <div
            className={`donate-qr-frame${
              qrExpired || order?.status === 'expired' ? ' is-expired' : ''
            }${showLoadingBox ? ' is-loading' : ''}`}
            aria-busy={showLoadingBox}
          >
            {showQrImg ? (
              <img
                key={order!.codeUrl}
                src={qrImageSrc(order!.codeUrl)}
                alt="微信扫码支付二维码"
                width={220}
                height={220}
                className={qrImgLoading || qrImgError ? 'is-pending' : ''}
                onLoad={() => {
                  setQrImgLoading(false);
                  setQrImgError(false);
                }}
                onError={() => {
                  setQrImgLoading(false);
                  setQrImgError(true);
                }}
              />
            ) : null}

            {showLoadingBox ? (
              <div className="donate-qr-loading" role="status">
                <span className="donate-qr-spinner" aria-hidden />
                <span>
                  {creating ? '正在生成收款码…' : '二维码加载中…'}
                </span>
              </div>
            ) : null}

            {!showQrImg && !showLoadingBox ? (
              <div className="donate-qr-placeholder">
                {qrExpired || order?.status === 'expired'
                  ? '二维码已过期，请刷新或切换金额'
                  : createError
                    ? createError
                    : qrImgError
                      ? '二维码图片加载失败，请点击刷新'
                      : '请选择赞赏金额'}
              </div>
            ) : null}

            {qrImgError && showQrImg ? (
              <div className="donate-qr-placeholder donate-qr-load-error">
                二维码图片加载失败
                <br />
                请点击下方「刷新二维码」
              </div>
            ) : null}

            {(qrExpired || order?.status === 'expired') && order?.codeUrl ? (
              <div className="donate-qr-expired-mask">已过期</div>
            ) : null}
          </div>
          <p className="donate-qr-hint">{statusLabel}</p>
          {order?.status === 'user_paying' ? (
            <p className="donate-qr-waiting">已扫码，等待付款确认…</p>
          ) : null}
          {pollHint ? <p className="donate-poll-hint">{pollHint}</p> : null}
          <div className="donate-amount-display">
            <span>应付</span>
            <strong>
              ¥
              {order && !creating
                ? formatAmount(order.amount)
                : valid
                  ? formatAmount(amount)
                  : '--'}
            </strong>
          </div>
          {order?.outTradeNo ? (
            <p className="donate-order-no">单号 {order.outTradeNo}</p>
          ) : null}
        </section>

        <section className="donate-card donate-form-card">
          <label className="donate-label" htmlFor="donate-amount">
            赞赏金额（元）
          </label>
          <div className="donate-presets">
            {PRESETS.map((n) => (
              <button
                key={n}
                type="button"
                className={`donate-preset${
                  Number(amountText) === n ? ' is-active' : ''
                }`}
                onClick={() => setAmountText(formatAmount(n))}
              >
                ¥{formatAmount(n)}
              </button>
            ))}
          </div>
          <div className="donate-amount-input-wrap">
            <span>¥</span>
            <input
              id="donate-amount"
              className="input donate-amount-input"
              inputMode="decimal"
              placeholder="输入任意金额"
              value={amountText}
              onChange={(e) => {
                const v = e.target.value.replace(/[^\d.]/g, '');
                const parts = v.split('.');
                const next =
                  parts.length <= 2
                    ? parts[0] +
                      (parts[1] != null ? `.${parts[1].slice(0, 2)}` : '')
                    : amountText;
                setAmountText(next);
              }}
            />
          </div>

          <label className="donate-label" htmlFor="donate-message">
            留言（选填）
          </label>
          <textarea
            id="donate-message"
            className="donate-message"
            rows={4}
            maxLength={120}
            placeholder="写一句鼓励或建议，我们会认真看的…"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <div className="donate-message-count">{message.length}/120</div>

          <button
            type="button"
            className="btn donate-pay-btn block"
            disabled={!valid || creating}
            onClick={onRefreshQr}
          >
            {creating ? '正在生成收款码…' : '刷新二维码'}
          </button>
          {order &&
          !creating &&
          (order.status === 'pending' || order.status === 'user_paying') ? (
            <button
              type="button"
              className="btn ghost block donate-confirm-paid-btn"
              onClick={onConfirmPaid}
            >
              我已完成支付
            </button>
          ) : null}
          <p className="donate-foot-note">
            选择或修改金额后会自动生成微信收款码；支付成功后页面会自动关闭。若已付款未跳转，可点「我已完成支付」。
          </p>
        </section>
      </main>
    </div>,
    document.body,
  );
}
