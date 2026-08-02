import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { useAuthStore } from '../../store/useAuthStore';
import { useAppStore } from '../../store/useAppStore';
import { apiDefaultAvatars, apiGetDocs, type SiteDocs } from '../../api/authApi';
import { compressDataUrl } from '../../image/padImage';

type Mode = 'login' | 'register';

const FALLBACK_AVATARS = [
  '/avatars/default-1.svg',
  '/avatars/default-2.svg',
  '/avatars/default-3.svg',
  '/avatars/default-4.svg',
];

export function LoginModal() {
  const open = useAuthStore((s) => s.loginOpen);
  const closeLogin = useAuthStore((s) => s.closeLogin);
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);
  const busy = useAuthStore((s) => s.busy);
  const pushToast = useAppStore((s) => s.pushToast);

  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [docOpen, setDocOpen] = useState<'terms' | 'privacy' | null>(null);
  const [docs, setDocs] = useState<SiteDocs | null>(null);
  const [avatars, setAvatars] = useState<string[]>(FALLBACK_AVATARS);
  const [avatar, setAvatar] = useState(FALLBACK_AVATARS[0]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setMode('login');
    setUsername('');
    setNickname('');
    setPassword('');
    setPassword2('');
    setPhone('');
    setError('');
    setAgreeTerms(false);
    setDocOpen(null);
    void apiDefaultAvatars()
      .then((r) => {
        if (r.defaults?.length) {
          setAvatars(r.defaults);
          setAvatar(r.defaults[0]);
        }
      })
      .catch(() => {
        /* keep fallback */
      });
    void apiGetDocs()
      .then((r) => setDocs(r.docs))
      .catch(() => setDocs(null));
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    setError('');
    if (mode === 'login') {
      const result = await login(username, password);
      if (result.ok) {
        pushToast(`欢迎，${username.trim()}`, 'success');
        return;
      }
      setError(result.error);
      return;
    }
    if (password !== password2) {
      setError('两次输入的密码不一致');
      return;
    }
    if (!nickname.trim()) {
      setError('请填写昵称');
      return;
    }
    if (!/^1\d{10}$/.test(phone.trim())) {
      setError('请输入有效的 11 位手机号码');
      return;
    }
    if (!agreeTerms) {
      setError('请先阅读并勾选同意用户须知与隐私协议');
      return;
    }
    const result = await register(
      username,
      password,
      phone.trim(),
      nickname.trim(),
      avatar,
    );
    if (result.ok) {
      pushToast(`注册成功，欢迎 ${nickname.trim()}`, 'success');
      return;
    }
    setError(result.error);
  };

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

  return (
    <div data-auth-free>
      <Modal
        title={mode === 'login' ? '登录 Aurora' : '注册 Aurora 账号'}
        subtitle={
          mode === 'login'
            ? '登录后可使用改图、图生模型等全部功能'
            : '创建账号后即可使用平台功能'
        }
        width={440}
        onClose={closeLogin}
        footer={
          <>
            <button type="button" className="btn ghost" onClick={closeLogin}>
              取消
            </button>
            <button
              type="button"
              className="btn holo"
              disabled={busy || (mode === 'register' && !agreeTerms)}
              onClick={() => void submit()}
            >
              {busy ? '请稍候…' : mode === 'login' ? '登录' : '注册并登录'}
            </button>
          </>
        }
      >
        <div className="auth-mode-tabs">
          <button
            type="button"
            className={mode === 'login' ? 'active' : ''}
            onClick={() => {
              setMode('login');
              setError('');
            }}
          >
            登录
          </button>
          <button
            type="button"
            className={mode === 'register' ? 'active' : ''}
            onClick={() => {
              setMode('register');
              setError('');
              setAgreeTerms(false);
            }}
          >
            注册
          </button>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="aurora-login-user">
            用户名
          </label>
          <input
            id="aurora-login-user"
            className="input"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
            }}
            placeholder="请输入用户名"
          />
        </div>
        {mode === 'register' && (
          <div className="field">
            <label className="field-label" htmlFor="aurora-login-nickname">
              昵称
            </label>
            <input
              id="aurora-login-nickname"
              className="input"
              value={nickname}
              maxLength={24}
              onChange={(e) => setNickname(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
              placeholder="展示给他人看的名字"
            />
          </div>
        )}
        <div className="field">
          <label className="field-label" htmlFor="aurora-login-pass">
            密码
          </label>
          <input
            id="aurora-login-pass"
            className="input"
            type="password"
            autoComplete={
              mode === 'login' ? 'current-password' : 'new-password'
            }
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
            }}
            placeholder={mode === 'login' ? '请输入密码' : '至少 6 位'}
          />
        </div>

        {mode === 'register' && (
          <>
            <div className="field">
              <label className="field-label" htmlFor="aurora-login-pass2">
                确认密码
              </label>
              <input
                id="aurora-login-pass2"
                className="input"
                type="password"
                autoComplete="new-password"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submit();
                }}
                placeholder="再次输入密码"
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="aurora-login-phone">
                手机号码
              </label>
              <input
                id="aurora-login-phone"
                className="input"
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                maxLength={11}
                value={phone}
                onChange={(e) =>
                  setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submit();
                }}
                placeholder="11 位手机号（暂不验证）"
              />
            </div>
            <div className="field">
              <label className="field-label">头像</label>
              <div className="auth-avatar-row">
                {avatars.map((a) => (
                  <button
                    key={a}
                    type="button"
                    className={`auth-avatar-pick${avatar === a ? ' active' : ''}`}
                    onClick={() => setAvatar(a)}
                    title="选择默认头像"
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
                  title="上传头像"
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
            <div className="field auth-terms-field">
              <label className="auth-terms-check">
                <input
                  type="checkbox"
                  checked={agreeTerms}
                  onChange={(e) => setAgreeTerms(e.target.checked)}
                />
                <span>
                  我已阅读并同意
                  <button
                    type="button"
                    className="auth-terms-link"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDocOpen('terms');
                    }}
                  >
                    《{docs?.termsTitle || '用户须知'}》
                  </button>
                  和
                  <button
                    type="button"
                    className="auth-terms-link"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDocOpen('privacy');
                    }}
                  >
                    《{docs?.privacyTitle || '隐私协议'}》
                  </button>
                </span>
              </label>
            </div>
          </>
        )}

        {error && <p className="login-error">{error}</p>}
      </Modal>

      {docOpen && (
        <Modal
          title={
            docOpen === 'privacy'
              ? docs?.privacyTitle || '隐私协议'
              : docs?.termsTitle || '用户须知'
          }
          subtitle="请仔细阅读后再勾选同意"
          width={520}
          onClose={() => setDocOpen(null)}
          footer={
            <button
              type="button"
              className="btn holo"
              onClick={() => {
                setAgreeTerms(true);
                setDocOpen(null);
              }}
            >
              我已阅读并同意
            </button>
          }
        >
          <div className="auth-terms-modal-body">
            <pre className="doc-body">
              {docOpen === 'privacy'
                ? docs?.privacyBody || '加载隐私协议中…'
                : docs?.termsBody || '加载用户须知中…'}
            </pre>
          </div>
        </Modal>
      )}
    </div>
  );
}
