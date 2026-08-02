import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiDonate } from '../../api/authApi';
import { useAppStore } from '../../store/useAppStore';
import { useAuthStore } from '../../store/useAuthStore';

const PRESETS = [9.9, 28, 66, 128, 520] as const;

function formatAmount(n: number) {
  if (!Number.isFinite(n) || n <= 0) return '';
  return n % 1 === 0 ? String(n) : n.toFixed(2);
}

function buildPayPayload(amount: number, message: string) {
  const msg = message.trim().slice(0, 120);
  return [
    'Aurora 赞赏',
    `金额: ¥${formatAmount(amount)}`,
    msg ? `留言: ${msg}` : '留言: （无）',
    `单号: AUR${Date.now().toString(36).toUpperCase()}`,
  ].join('\n');
}

export function DonatePage({ onClose }: { onClose: () => void }) {
  const pushToast = useAppStore((s) => s.pushToast);
  const token = useAuthStore((s) => s.token);
  const requireAuth = useAuthStore((s) => s.requireAuth);
  const setUser = useAuthStore((s) => s.setUser);
  const [amountText, setAmountText] = useState('28');
  const [message, setMessage] = useState('');
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const amount = Number.parseFloat(amountText);
  const valid = Number.isFinite(amount) && amount >= 0.01 && amount <= 99999;

  const qrSrc = useMemo(() => {
    if (!valid) return '';
    const data = encodeURIComponent(buildPayPayload(amount, message));
    return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=${data}`;
  }, [valid, amount, message]);

  const onPay = () => {
    if (!valid) {
      pushToast('请输入有效金额（最少 ¥0.01）', 'info');
      return;
    }
    if (!requireAuth() || !token) {
      pushToast('请先登录后再赞赏，以便记录到您的账户', 'info');
      return;
    }
    setPaying(true);
    void (async () => {
      try {
        const { user } = await apiDonate(token, amount, message);
        setUser(user);
        pushToast(
          `感谢赞赏 ¥${formatAmount(amount)}${message.trim() ? '，留言已收到' : ''}`,
          'success',
        );
        onClose();
      } catch (err) {
        pushToast(err instanceof Error ? err.message : String(err), 'error');
      } finally {
        setPaying(false);
      }
    })();
  };

  return createPortal(
    <div className="donate-page" data-auth-free role="dialog" aria-modal="true">
      <div className="donate-page-bg" aria-hidden />
      <header className="donate-page-head">
        <button type="button" className="btn ghost sm" onClick={onClose}>
          ← 返回
        </button>
        <div className="donate-page-titles">
          <h1>赞赏我们</h1>
          <p>扫码支付 · 支持任意金额 · 可选留言</p>
        </div>
      </header>

      <main className="donate-page-main">
        <section className="donate-card donate-qr-card">
          <div className="donate-qr-frame">
            {valid && qrSrc ? (
              <img src={qrSrc} alt="支付二维码" width={220} height={220} />
            ) : (
              <div className="donate-qr-placeholder">输入金额后生成收款码</div>
            )}
          </div>
          <p className="donate-qr-hint">
            请使用微信 / 支付宝扫码完成支付
          </p>
          <div className="donate-amount-display">
            <span>应付</span>
            <strong>¥{valid ? formatAmount(amount) : '--'}</strong>
          </div>
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
            disabled={!valid || paying}
            onClick={onPay}
          >
            {paying ? '正在确认支付…' : `确认支付 ¥${valid ? formatAmount(amount) : '0'}`}
          </button>
          <p className="donate-foot-note">
            扫码完成支付后点击确认，赞赏金额与留言将记录到您的账户。
          </p>
        </section>
      </main>
    </div>,
    document.body,
  );
}
