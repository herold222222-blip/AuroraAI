import { useEffect, useState } from 'react';
import {
  apiSendSms,
  type SmsPurpose,
} from '../../api/authApi';

interface SmsCodeFieldProps {
  phone: string;
  purpose: SmsPurpose;
  code: string;
  onCodeChange: (code: string) => void;
  token?: string | null;
  disabled?: boolean;
  onError?: (msg: string) => void;
  onInfo?: (msg: string) => void;
}

export function SmsCodeField({
  phone,
  purpose,
  code,
  onCodeChange,
  token,
  disabled,
  onError,
  onInfo,
}: SmsCodeFieldProps) {
  const [cooldown, setCooldown] = useState(0);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  const send = async () => {
    onError?.('');
    if (!/^1\d{10}$/.test(phone.trim())) {
      onError?.('请先填写有效的 11 位手机号码');
      return;
    }
    setSending(true);
    try {
      const r = await apiSendSms(phone.trim(), purpose, token);
      setCooldown(r.cooldownSec || 60);
      if (r.devCode) {
        onInfo?.(`开发模式验证码：${r.devCode}`);
        onCodeChange(r.devCode);
      } else {
        onInfo?.('验证码已发送，请查收短信');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '发送失败';
      onError?.(msg);
      const m = msg.match(/(\d+)\s*秒/);
      if (m) setCooldown(Number(m[1]));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="field">
      <label className="field-label" htmlFor={`sms-code-${purpose}`}>
        短信验证码
      </label>
      <div className="sms-code-row">
        <input
          id={`sms-code-${purpose}`}
          className="input"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={8}
          value={code}
          disabled={disabled}
          onChange={(e) =>
            onCodeChange(e.target.value.replace(/\D/g, '').slice(0, 8))
          }
          placeholder="6 位验证码"
        />
        <button
          type="button"
          className="btn ghost sms-send-btn"
          disabled={disabled || sending || cooldown > 0}
          onClick={() => void send()}
        >
          {sending ? '发送中…' : cooldown > 0 ? `${cooldown}s` : '获取验证码'}
        </button>
      </div>
    </div>
  );
}
