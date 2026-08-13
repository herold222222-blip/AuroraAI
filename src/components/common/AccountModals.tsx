import { useEffect, useRef, useState } from 'react';
import {
  apiDefaultAvatars,
  apiListMyDonateRecords,
  GEMINI_TO_QWEN_HINT,
  normalizeExtraCredits,
  QUOTA_EXCEEDED_HINT,
  type DonatePayRecord,
  type UsageKind,
  type UsageLedgerEntry,
} from '../../api/authApi';
import { compressDataUrl } from '../../image/padImage';
import { useAppStore } from '../../store/useAppStore';
import { useAuthStore } from '../../store/useAuthStore';
import { useImageStore } from '../../image/useImageStore';
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

function UsageKindCard({
  title,
  unlimited,
  dailyLimit,
  usedToday,
  extra,
}: {
  title: string;
  unlimited: boolean;
  dailyLimit: number | null | undefined;
  usedToday: number;
  extra: number;
}) {
  const freeRemain =
    unlimited || dailyLimit == null
      ? null
      : Math.max(0, dailyLimit - usedToday);
  return (
    <div className="usage-card">
      <h4>{title}</h4>
      <p>
        每日免费：
        <strong>{formatLimit(unlimited, dailyLimit)}</strong>
      </p>
      <p>
        今日已用：
        <strong>{usedToday}</strong>
        {freeRemain != null && (
          <span className="usage-remain"> · 免费剩余 {freeRemain}</span>
        )}
      </p>
      {!unlimited && (
        <p>
          额外次数：
          <strong>{extra}</strong>
          <span className="usage-remain">（免费用尽后消耗）</span>
        </p>
      )}
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

  const extras = normalizeExtraCredits(user.extraCredits);

  return (
    <div data-auth-free>
      <Modal
        title="查看用量"
        subtitle="先消耗每日免费次数，再消耗额外次数（免费额度每日 0 点重置，东八区）"
        width={440}
        onClose={onClose}
        footer={
          <button type="button" className="btn holo" onClick={onClose}>
            知道了
          </button>
        }
      >
        <div className="usage-cards">
          <UsageKindCard
            title="Gemini 改图"
            unlimited={user.geminiEditUnlimited}
            dailyLimit={user.geminiEditDailyLimit}
            usedToday={user.geminiEditUsedToday}
            extra={extras.geminiEdit}
          />
          <UsageKindCard
            title="千问改图"
            unlimited={user.qwenEditUnlimited}
            dailyLimit={user.qwenEditDailyLimit}
            usedToday={user.qwenEditUsedToday}
            extra={extras.qwenEdit}
          />
          <UsageKindCard
            title="图生模型"
            unlimited={user.modelGenUnlimited}
            dailyLimit={user.modelGenDailyLimit}
            usedToday={user.modelGenUsedToday}
            extra={extras.modelGen}
          />
        </div>
      </Modal>
    </div>
  );
}

function formatMoney(n: number) {
  return n.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatWalletTime(ts: number) {
  try {
    return new Date(ts).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return String(ts);
  }
}

const USAGE_KIND_LABEL: Record<UsageKind, string> = {
  geminiEdit: 'Gemini 改图',
  qwenEdit: '千问改图',
  modelGen: '图生模型',
};

function ledgerActionLabel(entry: UsageLedgerEntry): string {
  if (entry.action === 'consume_free') return '消耗免费次数';
  if (entry.action === 'consume_extra') return '消耗额外次数';
  return entry.delta >= 0 ? '管理员增加额外次数' : '管理员减少额外次数';
}

/** Personal sponsorship + usage ledger for logged-in users. */
export function WalletModal({ onClose }: { onClose: () => void }) {
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const setUser = useAuthStore((s) => s.setUser);
  const refreshMe = useAuthStore((s) => s.refreshMe);
  const [tab, setTab] = useState<'donate' | 'usage'>('donate');
  const [donateRecords, setDonateRecords] = useState<DonatePayRecord[]>([]);
  const [donateTotal, setDonateTotal] = useState(0);
  const [donateLoading, setDonateLoading] = useState(true);
  const [donateError, setDonateError] = useState('');

  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  useEffect(() => {
    if (!token) {
      setDonateLoading(false);
      return;
    }
    let cancelled = false;
    setDonateLoading(true);
    setDonateError('');
    void apiListMyDonateRecords(token)
      .then((res) => {
        if (cancelled) return;
        setDonateRecords(res.records || []);
        setDonateTotal(Number(res.total) || 0);
        // 同步到本地 user，便于其它入口读到最新累计
        const latest = useAuthStore.getState().user;
        if (latest) {
          setUser({
            ...latest,
            sponsorshipTotal: Number(res.total) || 0,
            sponsorships: (res.records || []).map((r) => ({
              id: r.id,
              amount: r.amount,
              message: r.message,
              createdAt: r.createdAt,
              outTradeNo: r.outTradeNo,
              transactionId: r.transactionId,
              payChannel: r.payChannel,
              paidAt: r.paidAt,
            })),
          });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setDonateError(err instanceof Error ? err.message : String(err));
        // 回退：至少展示 user 上已有的 sponsorships
        const fallback = [...(user?.sponsorships || [])].sort(
          (a, b) => b.createdAt - a.createdAt,
        );
        setDonateRecords(
          fallback.map((r) => ({
            id: r.id,
            amount: r.amount,
            message: r.message,
            createdAt: r.createdAt,
            paidAt: r.paidAt || r.createdAt,
            outTradeNo: r.outTradeNo,
            transactionId: r.transactionId,
            payChannel: 'wechat' as const,
            status: 'paid' as const,
          })),
        );
        setDonateTotal(
          typeof user?.sponsorshipTotal === 'number'
            ? user.sponsorshipTotal
            : fallback.reduce((s, r) => s + (Number(r.amount) || 0), 0),
        );
      })
      .finally(() => {
        if (!cancelled) setDonateLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // 仅随 token / 打开钱包拉取；避免 setUser 造成循环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (!user) return null;

  const records = donateRecords;
  const total = donateTotal;

  const ledger = [...(user.usageLedger || [])]
    .filter(
      (e) =>
        e.action === 'consume_free' ||
        e.action === 'consume_extra' ||
        e.action === 'adjust',
    )
    .sort((a, b) => b.createdAt - a.createdAt);

  const extras = normalizeExtraCredits(user.extraCredits);

  return (
    <div data-auth-free>
      <Modal
        title="我的钱包"
        subtitle="打赏记录与次数消耗明细"
        width={520}
        onClose={onClose}
        footer={
          <button type="button" className="btn holo" onClick={onClose}>
            关闭
          </button>
        }
      >
        <div className="wallet-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'donate'}
            className={`wallet-tab${tab === 'donate' ? ' is-active' : ''}`}
            onClick={() => setTab('donate')}
          >
            打赏记录
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'usage'}
            className={`wallet-tab${tab === 'usage' ? ' is-active' : ''}`}
            onClick={() => setTab('usage')}
          >
            次数明细
          </button>
        </div>

        {tab === 'donate' ? (
          <>
            <div className="wallet-summary">
              <div className="wallet-summary-main">
                <span>累计打赏</span>
                <strong>
                  {donateLoading ? '…' : `¥${formatMoney(total)}`}
                </strong>
              </div>
              <div className="wallet-summary-meta">
                {donateLoading ? '加载中…' : `共 ${records.length} 笔支付订单`}
              </div>
            </div>

            {donateError ? (
              <p className="wallet-msg is-muted">{donateError}</p>
            ) : null}

            {donateLoading ? (
              <div className="wallet-empty">正在加载支付订单…</div>
            ) : records.length === 0 ? (
              <div className="wallet-empty">
                暂无打赏记录。可通过顶部「赞赏我们」微信扫码支付后在此查看。
              </div>
            ) : (
              <ul className="wallet-list">
                {records.map((r) => (
                  <li key={r.id} className="wallet-row">
                    <div className="wallet-row-top">
                      <strong>¥{formatMoney(Number(r.amount) || 0)}</strong>
                      <time
                        dateTime={new Date(
                          r.paidAt || r.createdAt,
                        ).toISOString()}
                      >
                        {formatWalletTime(r.paidAt || r.createdAt)}
                      </time>
                    </div>
                    <p className="wallet-msg wallet-pay-meta">
                      微信支付 · 已支付
                      {r.outTradeNo ? ` · ${r.outTradeNo}` : ''}
                    </p>
                    {r.transactionId ? (
                      <p className="wallet-msg is-muted">
                        微信单号 {r.transactionId}
                      </p>
                    ) : null}
                    {r.message?.trim() ? (
                      <p className="wallet-msg">{r.message.trim()}</p>
                    ) : (
                      <p className="wallet-msg is-muted">（无留言）</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <>
            <div className="wallet-extra-summary">
              <span>
                Gemini 额外 <strong>{extras.geminiEdit}</strong>
              </span>
              <span>
                千问额外 <strong>{extras.qwenEdit}</strong>
              </span>
              <span>
                模型额外 <strong>{extras.modelGen}</strong>
              </span>
            </div>
            {ledger.length === 0 ? (
              <div className="wallet-empty">暂无次数消耗记录</div>
            ) : (
              <ul className="wallet-list">
                {ledger.map((e) => (
                  <li key={e.id} className="wallet-row">
                    <div className="wallet-row-top">
                      <strong>
                        {USAGE_KIND_LABEL[e.kind]} · {ledgerActionLabel(e)}
                        {e.delta !== 0
                          ? ` (${e.delta > 0 ? '+' : ''}${e.delta})`
                          : ''}
                      </strong>
                      <time dateTime={new Date(e.createdAt).toISOString()}>
                        {formatWalletTime(e.createdAt)}
                      </time>
                    </div>
                    <p className="wallet-msg is-muted">
                      额外余额 {e.extraAfter}
                      {e.byAdminName ? ` · 操作人 ${e.byAdminName}` : ''}
                      {e.note?.trim() ? ` · ${e.note.trim()}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}

export function QuotaExhaustedModal() {
  const open = useAuthStore((s) => s.quotaOpen);
  const kind = useAuthStore((s) => s.quotaModalKind);
  const close = useAuthStore((s) => s.closeQuotaModal);
  const setEditModel = useImageStore((s) => s.setEditModel);
  const pushToast = useAppStore((s) => s.pushToast);

  if (!open) return null;

  const switchToQwen = kind === 'switchToQwen';

  const onConfirm = () => {
    if (switchToQwen) {
      setEditModel('qwen-image');
      pushToast('已切换到千问模型', 'success');
    }
    close();
  };

  return (
    <div data-auth-free>
      <Modal
        title={switchToQwen ? 'Gemini 额度已用完' : '账户限额已用完'}
        width={440}
        onClose={close}
        footer={
          <button type="button" className="btn holo" onClick={onConfirm}>
            确认
          </button>
        }
      >
        <p className="quota-modal-text">
          {switchToQwen ? GEMINI_TO_QWEN_HINT : QUOTA_EXCEEDED_HINT}
        </p>
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
