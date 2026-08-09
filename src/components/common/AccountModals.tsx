import { useEffect, useRef, useState } from 'react';
import { apiDefaultAvatars } from '../../api/authApi';
import { QUOTA_EXCEEDED_HINT } from '../../api/authApi';
import { compressDataUrl } from '../../image/padImage';
import { useAppStore } from '../../store/useAppStore';
import { useAuthStore } from '../../store/useAuthStore';
import { Modal } from './Modal';
import { SmsCodeField } from './SmsCodeField';

const FALLBACK_AVATARS = [
  '/avatars/default-1.svg',
  '/avatars/default-2.svg',
  '/avatars/default-3.svg',
  '/avatars/default-4.svg',
];

function formatLimit(unlimited: boolean, limit: number | null | undefined) {
  if (unlimited || limit == null) return '不限';
  return `${limit} 次/天`;
}

export function ProfileModal({ onClose }: { onClose: () => void }) {
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const busy = useAuthStore((s) => s.busy);
  const pushToast = useAppStore((s) => s.pushToast);

  const [nickname, setNickname] = useState(user?.nickname || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [smsCode, setSmsCode] = useState('');
  const [avatar, setAvatar] = useState(
    user?.avatar || FALLBACK_AVATARS[0],
  );
  const [avatars, setAvatars] = useState<string[]>(FALLBACK_AVATARS);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const phoneChanged = phone.trim() !== (user?.phone || '').trim();

  useEffect(() => {
    void apiDefaultAvatars()
      .then((r) => {
        if (r.defaults?.length) setAvatars(r.defaults);
      })
      .catch(() => {
        /* keep fallback */
      });
  }, []);

  const onUploadAvatar = async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('请上传图片文件作为头像');
      return;
    }
    try {
      const reader = new FileReader();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('读取头像失败'));
        reader.readAsDataURL(file);
      });
      const compressed = await compressDataUrl(dataUrl, 256, 0.85);
      setAvatar(compressed);
    } catch (err) {
      setError(err instanceof Error ? err.message : '头像处理失败');
    }
  };

  const save = async () => {
    setError('');
    if (!nickname.trim()) {
      setError('请填写昵称');
      return;
    }
    if (!/^1\d{10}$/.test(phone.trim())) {
      setError('请输入有效的 11 位手机号码');
      return;
    }
    if (phoneChanged && !/^\d{4,8}$/.test(smsCode.trim())) {
      setError('修改手机号需填写短信验证码');
      return;
    }
    const result = await updateProfile({
      nickname: nickname.trim(),
      phone: phone.trim(),
      avatar,
      ...(phoneChanged ? { smsCode: smsCode.trim() } : {}),
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    pushToast('个人信息已更新', 'success');
    onClose();
  };

  return (
    <div data-auth-free>
      <Modal
        title="修改个人信息"
        subtitle={`账号：${user?.username || ''}`}
        width={440}
        onClose={onClose}
        footer={
          <>
            <button type="button" className="btn ghost" onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className="btn holo"
              disabled={busy}
              onClick={() => void save()}
            >
              {busy ? '保存中…' : '保存'}
            </button>
          </>
        }
      >
        <div className="field">
          <label className="field-label" htmlFor="profile-nickname">
            昵称
          </label>
          <input
            id="profile-nickname"
            className="input"
            value={nickname}
            maxLength={24}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="1–24 个字符"
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="profile-phone">
            手机号码
          </label>
          <input
            id="profile-phone"
            className="input"
            type="tel"
            inputMode="numeric"
            maxLength={11}
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value.replace(/\D/g, '').slice(0, 11));
              setSmsCode('');
              setInfo('');
            }}
            placeholder="11 位手机号"
          />
        </div>
        {phoneChanged && (
          <SmsCodeField
            phone={phone}
            purpose="change_phone"
            code={smsCode}
            onCodeChange={setSmsCode}
            token={token}
            disabled={busy}
            onError={(msg) => {
              setError(msg);
              if (msg) setInfo('');
            }}
            onInfo={(msg) => {
              setInfo(msg);
              setError('');
            }}
          />
        )}
        <div className="field">
          <label className="field-label">头像</label>
          <div className="auth-avatar-row">
            {avatars.map((a) => (
              <button
                key={a}
                type="button"
                className={`auth-avatar-pick${avatar === a ? ' active' : ''}`}
                onClick={() => setAvatar(a)}
              >
                <img src={a} alt="" />
              </button>
            ))}
            <button
              type="button"
              className={`auth-avatar-pick upload${
                avatar.startsWith('data:') ? ' active' : ''
              }`}
              onClick={() => fileRef.current?.click()}
            >
              {avatar.startsWith('data:') ? (
                <img src={avatar} alt="" />
              ) : (
                <span>上传</span>
              )}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                void onUploadAvatar(e.target.files?.[0] ?? null);
                e.target.value = '';
              }}
            />
          </div>
        </div>
        {info && !error && <p className="login-info">{info}</p>}
        {error && <p className="login-error">{error}</p>}
      </Modal>
    </div>
  );
}

export function UsageModal({ onClose }: { onClose: () => void }) {
  const user = useAuthStore((s) => s.user);
  const refreshMe = useAuthStore((s) => s.refreshMe);

  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  if (!user) return null;

  return (
    <div data-auth-free>
      <Modal
        title="查看用量"
        subtitle="今日限额与已消耗次数（每日 0 点重置，东八区）"
        width={420}
        onClose={onClose}
        footer={
          <button type="button" className="btn holo" onClick={onClose}>
            知道了
          </button>
        }
      >
        <div className="usage-cards">
          <div className="usage-card">
            <h4>Gemini 改图</h4>
            <p>
              限额：
              <strong>
                {formatLimit(
                  user.geminiEditUnlimited,
                  user.geminiEditDailyLimit,
                )}
              </strong>
            </p>
            <p>
              已用：
              <strong>{user.geminiEditUsedToday}</strong>
              {!user.geminiEditUnlimited &&
                user.geminiEditDailyLimit != null && (
                  <span className="usage-remain">
                    {' '}
                    · 剩余{' '}
                    {Math.max(
                      0,
                      user.geminiEditDailyLimit - user.geminiEditUsedToday,
                    )}
                  </span>
                )}
            </p>
          </div>
          <div className="usage-card">
            <h4>千问改图</h4>
            <p>
              限额：
              <strong>
                {formatLimit(user.qwenEditUnlimited, user.qwenEditDailyLimit)}
              </strong>
            </p>
            <p>
              已用：
              <strong>{user.qwenEditUsedToday}</strong>
              {!user.qwenEditUnlimited && user.qwenEditDailyLimit != null && (
                <span className="usage-remain">
                  {' '}
                  · 剩余{' '}
                  {Math.max(
                    0,
                    user.qwenEditDailyLimit - user.qwenEditUsedToday,
                  )}
                </span>
              )}
            </p>
          </div>
          <div className="usage-card">
            <h4>图生模型</h4>
            <p>
              限额：
              <strong>
                {formatLimit(user.modelGenUnlimited, user.modelGenDailyLimit)}
              </strong>
            </p>
            <p>
              已用：
              <strong>{user.modelGenUsedToday}</strong>
              {!user.modelGenUnlimited && user.modelGenDailyLimit != null && (
                <span className="usage-remain">
                  {' '}
                  · 剩余{' '}
                  {Math.max(
                    0,
                    user.modelGenDailyLimit - user.modelGenUsedToday,
                  )}
                </span>
              )}
            </p>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export function QuotaExhaustedModal() {
  const open = useAuthStore((s) => s.quotaOpen);
  const close = useAuthStore((s) => s.closeQuotaModal);
  if (!open) return null;
  return (
    <div data-auth-free>
      <Modal
        title="账户限额已用完"
        width={440}
        onClose={close}
        footer={
          <button type="button" className="btn holo" onClick={close}>
            我知道了
          </button>
        }
      >
        <p className="quota-modal-text">{QUOTA_EXCEEDED_HINT}</p>
      </Modal>
    </div>
  );
}

/** Shown when a non-admin tries to enter 图生模型 / 3D generation. */
export function ModelDevBlockedModal() {
  const open = useAppStore((s) => s.modelDevBlockedOpen);
  const close = useAppStore((s) => s.closeModelDevBlocked);
  if (!open) return null;
  return (
    <div data-auth-free>
      <Modal
        title="功能提示"
        width={420}
        onClose={close}
        footer={
          <button type="button" className="btn holo" onClick={close}>
            我知道了
          </button>
        }
      >
        <p className="quota-modal-text">
          当前功能正在开发中，如需更多帮助请联系万生19806651984。
        </p>
      </Modal>
    </div>
  );
}
