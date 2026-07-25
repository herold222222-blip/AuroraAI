import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { useAuthStore } from '../../store/useAuthStore';
import { useAppStore } from '../../store/useAppStore';

export function LoginModal() {
  const open = useAuthStore((s) => s.loginOpen);
  const closeLogin = useAuthStore((s) => s.closeLogin);
  const login = useAuthStore((s) => s.login);
  const pushToast = useAppStore((s) => s.pushToast);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setUsername('');
    setPassword('');
    setError('');
  }, [open]);

  if (!open) return null;

  const submit = () => {
    const result = login(username, password);
    if (result.ok) {
      pushToast(`欢迎，${username.trim()}`, 'success');
      return;
    }
    setError(result.error);
  };

  return (
    <div data-auth-free>
      <Modal
        title="登录 Aurora"
        subtitle="Demo 演示版暂不开放注册，请使用测试账号登录后使用功能"
        width={420}
        onClose={closeLogin}
        footer={
          <>
            <button type="button" className="btn ghost" onClick={closeLogin}>
              取消
            </button>
            <button type="button" className="btn holo" onClick={submit}>
              登录
            </button>
          </>
        }
      >
        <p className="login-demo-hint">
          如需获取访问权限，联系万生 19806651984
        </p>
        <div className="field">
          <label className="field-label" htmlFor="aurora-login-user">
            账号
          </label>
          <input
            id="aurora-login-user"
            className="input"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
            placeholder="请输入账号"
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="aurora-login-pass">
            密码
          </label>
          <input
            id="aurora-login-pass"
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
            placeholder="请输入密码"
          />
        </div>
        {error && <p className="login-error">{error}</p>}
      </Modal>
    </div>
  );
}
