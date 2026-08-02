import { useCallback, useEffect, useState } from 'react';
import {
  apiDeleteApi,
  apiDeleteDonation,
  apiDeleteUser,
  apiGetDocs,
  apiListApis,
  apiListDonations,
  apiListUsers,
  apiSaveDocs,
  apiUpdateApi,
  apiUpdateUser,
  type AuthUser,
  type DonationMessage,
  type ManagedApi,
  type SiteDocs,
  type SponsorshipRecord,
} from '../../api/authApi';
import { useAuthStore } from '../../store/useAuthStore';
import { useAppStore } from '../../store/useAppStore';
import { Modal } from '../common/Modal';

type Tab = 'users' | 'donations' | 'docs' | 'apis';

type PendingDelete =
  | { kind: 'user'; id: string; label: string }
  | { kind: 'donation'; id: string; label: string }
  | null;

const ADMIN_DELETE_CODE = '205588';

type Draft = {
  note: string;
  phone: string;
  imageUnlimited: boolean;
  imageLimit: string;
  modelUnlimited: boolean;
  modelLimit: string;
  password: string;
};

function formatMoney(n: number) {
  if (!Number.isFinite(n)) return '0';
  return n % 1 === 0 ? String(n) : n.toFixed(2);
}

function formatTime(ts: number) {
  try {
    return new Date(ts).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return String(ts);
  }
}

function toDraft(u: AuthUser): Draft {
  return {
    note: u.note || '',
    phone: u.phone || '',
    imageUnlimited: u.imageEditUnlimited || u.imageEditDailyLimit == null,
    imageLimit: String(
      u.imageEditDailyLimit == null ? 20 : u.imageEditDailyLimit,
    ),
    modelUnlimited: u.modelGenUnlimited || u.modelGenDailyLimit == null,
    modelLimit: String(
      u.modelGenDailyLimit == null ? 20 : u.modelGenDailyLimit,
    ),
    password: '',
  };
}

export function AdminPanel() {
  const token = useAuthStore((s) => s.token);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const enterModelModule = useAppStore((s) => s.enterModelModule);
  const pushToast = useAppStore((s) => s.pushToast);

  const [tab, setTab] = useState<Tab>('users');
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [donations, setDonations] = useState<DonationMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [sponsorUser, setSponsorUser] = useState<AuthUser | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [docs, setDocs] = useState<SiteDocs | null>(null);
  const [docsBusy, setDocsBusy] = useState(false);
  const [apis, setApis] = useState<ManagedApi[]>([]);
  const [apiBusyId, setApiBusyId] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    if (!token || !isAdmin()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { users: list } = await apiListUsers(token);
      setUsers(list);
      const next: Record<string, Draft> = {};
      for (const u of list) next[u.id] = toDraft(u);
      setDrafts(next);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setLoading(false);
    }
  }, [token, isAdmin, pushToast]);

  const loadDonations = useCallback(async () => {
    if (!token || !isAdmin()) return;
    setLoading(true);
    try {
      const { donations: list } = await apiListDonations(token);
      setDonations(list);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setLoading(false);
    }
  }, [token, isAdmin, pushToast]);

  const loadDocs = useCallback(async () => {
    if (!token || !isAdmin()) return;
    setLoading(true);
    try {
      const { docs: d } = await apiGetDocs();
      setDocs(d);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setLoading(false);
    }
  }, [token, isAdmin, pushToast]);

  const loadApis = useCallback(async () => {
    if (!token || !isAdmin()) return;
    setLoading(true);
    try {
      const { apis: list } = await apiListApis(token);
      setApis(list);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setLoading(false);
    }
  }, [token, isAdmin, pushToast]);

  useEffect(() => {
    if (tab === 'users') void loadUsers();
    else if (tab === 'donations') void loadDonations();
    else if (tab === 'docs') void loadDocs();
    else void loadApis();
  }, [tab, loadUsers, loadDonations, loadDocs, loadApis]);

  if (!isAdmin()) {
    return (
      <div className="admin-page">
        <div className="admin-empty">需要超级管理员权限</div>
        <button
          type="button"
          className="btn soft"
          onClick={() => enterModelModule()}
        >
          返回
        </button>
      </div>
    );
  }

  const save = async (u: AuthUser) => {
    if (!token) return;
    const d = drafts[u.id];
    if (!d) return;
    if (d.phone && !/^1\d{10}$/.test(d.phone.trim())) {
      pushToast('手机号需为 11 位有效号码', 'error');
      return;
    }
    setSavingId(u.id);
    try {
      const patch: Parameters<typeof apiUpdateUser>[2] = {
        note: d.note,
        phone: d.phone.trim(),
        imageEditDailyLimit: u.role === 'admin'
          ? null
          : d.imageUnlimited
            ? null
            : Math.max(0, Math.floor(Number(d.imageLimit) || 0)),
        modelGenDailyLimit: u.role === 'admin'
          ? null
          : d.modelUnlimited
            ? null
            : Math.max(0, Math.floor(Number(d.modelLimit) || 0)),
      };
      if (d.password.trim().length >= 6) patch.password = d.password.trim();
      const { user } = await apiUpdateUser(token, u.id, patch);
      setUsers((prev) => prev.map((x) => (x.id === user.id ? user : x)));
      setDrafts((prev) => ({ ...prev, [user.id]: toDraft(user) }));
      pushToast(`已更新「${user.username}」`, 'success');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setSavingId(null);
    }
  };

  const setDraft = (id: string, patch: Partial<Draft>) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...(prev[id] || toDraft(users.find((x) => x.id === id)!)), ...patch },
    }));
  };

  const confirmDelete = async (securityCode: string) => {
    if (!token || !pendingDelete) return;
    setDeleteBusy(true);
    try {
      if (pendingDelete.kind === 'user') {
        await apiDeleteUser(token, pendingDelete.id, securityCode);
        setUsers((prev) => prev.filter((u) => u.id !== pendingDelete.id));
        pushToast(`已删除用户「${pendingDelete.label}」`, 'success');
      } else {
        await apiDeleteDonation(token, pendingDelete.id, securityCode);
        setDonations((prev) => prev.filter((d) => d.id !== pendingDelete.id));
        pushToast('已删除该条赞赏留言', 'success');
      }
      setPendingDelete(null);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="admin-page">
      <div className="admin-head">
        <div>
          <h2>超级管理员工作台</h2>
          <p>用户、赞赏、文档与 API 管理</p>
        </div>
        <div className="admin-head-actions">
          <button
            type="button"
            className="btn soft sm"
            onClick={() =>
              void (
                tab === 'users'
                  ? loadUsers()
                  : tab === 'donations'
                    ? loadDonations()
                    : tab === 'docs'
                      ? loadDocs()
                      : loadApis()
              )
            }
          >
            刷新
          </button>
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => enterModelModule()}
          >
            返回
          </button>
        </div>
      </div>

      <div className="admin-tabs">
        <button
          type="button"
          className={tab === 'users' ? 'active' : ''}
          onClick={() => setTab('users')}
        >
          用户管理
        </button>
        <button
          type="button"
          className={tab === 'donations' ? 'active' : ''}
          onClick={() => setTab('donations')}
        >
          赞赏留言
        </button>
        <button
          type="button"
          className={tab === 'docs' ? 'active' : ''}
          onClick={() => setTab('docs')}
        >
          文档管理
        </button>
        <button
          type="button"
          className={tab === 'apis' ? 'active' : ''}
          onClick={() => setTab('apis')}
        >
          API 管理
        </button>
      </div>

      {loading ? (
        <div className="admin-empty">加载中…</div>
      ) : tab === 'apis' ? (
        <ApisManager
          apis={apis}
          busyId={apiBusyId}
          onToggle={async (api, enabled) => {
            if (!token) return;
            setApiBusyId(api.id);
            try {
              const { api: next } = await apiUpdateApi(token, api.id, {
                enabled,
              });
              setApis((prev) =>
                prev.map((a) => (a.id === next.id ? next : a)),
              );
              pushToast(
                enabled ? `已启用「${next.name}」` : `已禁用「${next.name}」`,
                'success',
              );
            } catch (err) {
              pushToast(
                err instanceof Error ? err.message : String(err),
                'error',
              );
            } finally {
              setApiBusyId(null);
            }
          }}
          onSave={async (api, patch) => {
            if (!token) return;
            setApiBusyId(api.id);
            try {
              const { api: next } = await apiUpdateApi(token, api.id, patch);
              setApis((prev) =>
                prev.map((a) => (a.id === next.id ? next : a)),
              );
              pushToast(`已保存「${next.name}」`, 'success');
            } catch (err) {
              pushToast(
                err instanceof Error ? err.message : String(err),
                'error',
              );
            } finally {
              setApiBusyId(null);
            }
          }}
          onDelete={async (api) => {
            if (!token) return;
            if (
              !window.confirm(
                `确认删除 API「${api.name}」？删除后预置项不会自动恢复。`,
              )
            ) {
              return;
            }
            setApiBusyId(api.id);
            try {
              await apiDeleteApi(token, api.id);
              setApis((prev) => prev.filter((a) => a.id !== api.id));
              pushToast(`已删除「${api.name}」`, 'success');
            } catch (err) {
              pushToast(
                err instanceof Error ? err.message : String(err),
                'error',
              );
            } finally {
              setApiBusyId(null);
            }
          }}
        />
      ) : tab === 'docs' ? (
        docs ? (
          <DocsEditor
            docs={docs}
            busy={docsBusy}
            onChange={setDocs}
            onSave={async () => {
              if (!token || !docs) return;
              setDocsBusy(true);
              try {
                const { docs: saved } = await apiSaveDocs(token, docs);
                setDocs(saved);
                pushToast('文档已保存', 'success');
              } catch (err) {
                pushToast(
                  err instanceof Error ? err.message : String(err),
                  'error',
                );
              } finally {
                setDocsBusy(false);
              }
            }}
          />
        ) : (
          <div className="admin-empty">文档加载失败</div>
        )
      ) : tab === 'donations' ? (
        donations.length === 0 ? (
          <div className="admin-empty">暂无赞赏留言</div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>用户</th>
                  <th>金额</th>
                  <th>留言</th>
                  <th>时间</th>
                  <th className="col-action" />
                </tr>
              </thead>
              <tbody>
                {donations.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <strong>{d.username}</strong>
                    </td>
                    <td>¥{formatMoney(d.amount)}</td>
                    <td className="admin-msg">
                      {d.message?.trim() ? d.message : '（无留言）'}
                    </td>
                    <td className="admin-ip">{formatTime(d.createdAt)}</td>
                    <td className="col-action">
                      <button
                        type="button"
                        className="btn ghost sm admin-del-btn"
                        onClick={() =>
                          setPendingDelete({
                            kind: 'donation',
                            id: d.id,
                            label: `${d.username} · ¥${formatMoney(d.amount)}`,
                          })
                        }
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : users.length === 0 ? (
        <div className="admin-empty">暂无用户</div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table admin-table-wide">
            <thead>
              <tr>
                <th className="col-user">用户</th>
                <th className="col-level">等级</th>
                <th className="col-phone">手机号</th>
                <th className="col-region">地区</th>
                <th className="col-limit">
                  图片生成/修改
                  <span>次/天</span>
                </th>
                <th className="col-limit">
                  图生模型
                  <span>次/天</span>
                </th>
                <th className="col-sponsor">累计赞助</th>
                <th className="col-note">备注</th>
                <th className="col-pass">重置密码</th>
                <th className="col-action" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const d = drafts[u.id] || toDraft(u);
                const isSuper = u.role === 'admin';
                return (
                  <tr key={u.id}>
                    <td className="col-user">
                      <div className="admin-user-cell">
                        <img
                          className="admin-avatar"
                          src={u.avatar || '/avatars/default-1.svg'}
                          alt=""
                        />
                        <div className="admin-user-meta">
                          <strong>{u.nickname || u.username}</strong>
                          <em>@{u.username}</em>
                        </div>
                      </div>
                    </td>
                    <td className="col-level">
                      <span
                        className={`admin-level-tag${
                          isSuper ? ' is-admin' : ''
                        }`}
                      >
                        {u.levelLabel || '普通用户'}
                      </span>
                    </td>
                    <td className="col-phone">
                      <input
                        className="input admin-phone"
                        value={d.phone}
                        placeholder="手机号"
                        maxLength={11}
                        onChange={(e) =>
                          setDraft(u.id, {
                            phone: e.target.value.replace(/\D/g, '').slice(0, 11),
                          })
                        }
                      />
                    </td>
                    <td className="col-region admin-ip">
                      {u.lastRegion || '—'}
                    </td>
                    <td className="col-limit">
                      <LimitEditor
                        disabled={isSuper}
                        unlimited={isSuper || d.imageUnlimited}
                        limit={d.imageLimit}
                        used={u.imageEditUsedToday}
                        onUnlimited={(v) =>
                          setDraft(u.id, { imageUnlimited: v })
                        }
                        onLimit={(v) => setDraft(u.id, { imageLimit: v })}
                      />
                    </td>
                    <td className="col-limit">
                      <LimitEditor
                        disabled={isSuper}
                        unlimited={isSuper || d.modelUnlimited}
                        limit={d.modelLimit}
                        used={u.modelGenUsedToday}
                        onUnlimited={(v) =>
                          setDraft(u.id, { modelUnlimited: v })
                        }
                        onLimit={(v) => setDraft(u.id, { modelLimit: v })}
                      />
                    </td>
                    <td className="col-sponsor">
                      <button
                        type="button"
                        className="admin-sponsor-btn"
                        onClick={() => setSponsorUser(u)}
                        title="查看赞助明细"
                      >
                        ¥{formatMoney(u.sponsorshipTotal || 0)}
                      </button>
                    </td>
                    <td className="col-note">
                      <input
                        className="input admin-note"
                        value={d.note}
                        placeholder="备注"
                        onChange={(e) =>
                          setDraft(u.id, { note: e.target.value })
                        }
                      />
                    </td>
                    <td className="col-pass">
                      <input
                        className="input admin-pass"
                        type="password"
                        value={d.password}
                        placeholder="留空不改"
                        onChange={(e) =>
                          setDraft(u.id, { password: e.target.value })
                        }
                      />
                    </td>
                    <td className="col-action">
                      <div className="admin-action-row">
                        <button
                          type="button"
                          className="btn holo sm"
                          disabled={savingId === u.id}
                          onClick={() => void save(u)}
                        >
                          {savingId === u.id ? '保存中' : '保存'}
                        </button>
                        {!isSuper && (
                          <button
                            type="button"
                            className="btn ghost sm admin-del-btn"
                            onClick={() =>
                              setPendingDelete({
                                kind: 'user',
                                id: u.id,
                                label: u.nickname || u.username,
                              })
                            }
                          >
                            删除
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {sponsorUser && (
        <Modal
          title={`赞助明细 · ${sponsorUser.username}`}
          subtitle={`累计 ¥${formatMoney(sponsorUser.sponsorshipTotal || 0)}`}
          width={480}
          onClose={() => setSponsorUser(null)}
        >
          <SponsorshipList items={sponsorUser.sponsorships || []} />
        </Modal>
      )}

      {pendingDelete && (
        <SecurityDeleteModal
          title={
            pendingDelete.kind === 'user' ? '确认删除用户' : '确认删除赞赏留言'
          }
          detail={
            pendingDelete.kind === 'user'
              ? `将永久删除用户「${pendingDelete.label}」，此操作不可恢复。`
              : `将永久删除赞赏记录「${pendingDelete.label}」，此操作不可恢复。`
          }
          busy={deleteBusy}
          onClose={() => {
            if (!deleteBusy) setPendingDelete(null);
          }}
          onConfirm={(code) => void confirmDelete(code)}
        />
      )}
    </div>
  );
}

function SecurityDeleteModal({
  title,
  detail,
  busy,
  onClose,
  onConfirm,
}: {
  title: string;
  detail: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: (code: string) => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  return (
    <div data-auth-free>
      <Modal
        title={title}
        subtitle="二次确认 · 需输入安全码"
        width={440}
        onClose={onClose}
        footer={
          step === 1 ? (
            <>
              <button type="button" className="btn ghost" onClick={onClose}>
                取消
              </button>
              <button
                type="button"
                className="btn holo"
                onClick={() => setStep(2)}
              >
                继续删除
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn ghost"
                disabled={busy}
                onClick={onClose}
              >
                取消
              </button>
              <button
                type="button"
                className="btn holo"
                disabled={busy}
                onClick={() => {
                  setError('');
                  if (code.trim() !== ADMIN_DELETE_CODE) {
                    setError('安全码错误，请重新输入 6 位安全码');
                    return;
                  }
                  onConfirm(code.trim());
                }}
              >
                {busy ? '删除中…' : '确认删除'}
              </button>
            </>
          )
        }
      >
        {step === 1 ? (
          <p className="quota-modal-text">{detail}</p>
        ) : (
          <>
            <p className="quota-modal-text">
              请再次确认，并输入 6 位安全码后完成删除。
            </p>
            <div className="field" style={{ marginTop: 14 }}>
              <label className="field-label" htmlFor="admin-security-code">
                安全码
              </label>
              <input
                id="admin-security-code"
                className="input"
                inputMode="numeric"
                maxLength={6}
                autoComplete="off"
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !busy) {
                    setError('');
                    if (code.trim() !== ADMIN_DELETE_CODE) {
                      setError('安全码错误，请重新输入 6 位安全码');
                      return;
                    }
                    onConfirm(code.trim());
                  }
                }}
                placeholder="请输入 6 位安全码"
              />
            </div>
            {error && <p className="login-error">{error}</p>}
          </>
        )}
      </Modal>
    </div>
  );
}

function ApisManager({
  apis,
  busyId,
  onToggle,
  onSave,
  onDelete,
}: {
  apis: ManagedApi[];
  busyId: string | null;
  onToggle: (api: ManagedApi, enabled: boolean) => Promise<void>;
  onSave: (
    api: ManagedApi,
    patch: {
      name: string;
      provider: string;
      purpose: string;
      model: string;
      baseUrl: string;
      note: string;
      apiKey?: string | null;
    },
  ) => Promise<void>;
  onDelete: (api: ManagedApi) => Promise<void>;
}) {
  if (!apis.length) {
    return <div className="admin-empty">暂无 API 配置</div>;
  }
  return (
    <div className="admin-apis">
      <p className="admin-apis-hint">
        预置 Gemini / 千问 / Meshy。可修改名称、模型、地址与备注；密钥留空则继续使用环境变量。禁用后对应功能将不可用。
      </p>
      {apis.map((api) => (
        <ApiCard
          key={api.id}
          api={api}
          busy={busyId === api.id}
          onToggle={onToggle}
          onSave={onSave}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

function ApiCard({
  api,
  busy,
  onToggle,
  onSave,
  onDelete,
}: {
  api: ManagedApi;
  busy: boolean;
  onToggle: (api: ManagedApi, enabled: boolean) => Promise<void>;
  onSave: (
    api: ManagedApi,
    patch: {
      name: string;
      provider: string;
      purpose: string;
      model: string;
      baseUrl: string;
      note: string;
      apiKey?: string | null;
    },
  ) => Promise<void>;
  onDelete: (api: ManagedApi) => Promise<void>;
}) {
  const [name, setName] = useState(api.name);
  const [provider, setProvider] = useState(api.provider);
  const [purpose, setPurpose] = useState(api.purpose);
  const [model, setModel] = useState(api.model);
  const [baseUrl, setBaseUrl] = useState(api.baseUrl);
  const [note, setNote] = useState(api.note);
  const [apiKey, setApiKey] = useState('');

  useEffect(() => {
    setName(api.name);
    setProvider(api.provider);
    setPurpose(api.purpose);
    setModel(api.model);
    setBaseUrl(api.baseUrl);
    setNote(api.note);
    setApiKey('');
  }, [api]);

  return (
    <section className={`admin-api-card${api.enabled ? '' : ' is-off'}`}>
      <div className="admin-api-card-head">
        <div>
          <h3>{api.name}</h3>
          <p>
            {api.provider} · {api.kind}
            {api.isPreset ? ' · 预置' : ''} · 密钥 {api.keyHint}
          </p>
        </div>
        <div className="admin-api-card-actions">
          <label className="admin-api-switch">
            <input
              type="checkbox"
              checked={api.enabled}
              disabled={busy}
              onChange={(e) => void onToggle(api, e.target.checked)}
            />
            {api.enabled ? '已启用' : '已禁用'}
          </label>
          <button
            type="button"
            className="btn ghost sm admin-del-btn"
            disabled={busy}
            onClick={() => void onDelete(api)}
          >
            删除
          </button>
        </div>
      </div>
      <div className="admin-api-grid">
        <div className="field">
          <label className="field-label">名称</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="field-label">提供商</label>
          <input
            className="input"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="field-label">用途</label>
          <input
            className="input"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="field-label">模型</label>
          <input
            className="input"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
        </div>
        <div className="field admin-api-span2">
          <label className="field-label">接口地址（可选）</label>
          <input
            className="input"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="留空使用默认"
          />
        </div>
        <div className="field admin-api-span2">
          <label className="field-label">
            API 密钥（可选，当前 {api.keyHint}）
          </label>
          <input
            className="input"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="留空沿用环境变量 / 已有密钥"
            autoComplete="off"
          />
        </div>
        <div className="field admin-api-span2">
          <label className="field-label">备注</label>
          <input
            className="input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </div>
      <div className="admin-api-foot">
        <button
          type="button"
          className="btn holo sm"
          disabled={busy}
          onClick={() =>
            void onSave(api, {
              name,
              provider,
              purpose,
              model,
              baseUrl,
              note,
              ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
            })
          }
        >
          {busy ? '保存中…' : '保存修改'}
        </button>
        {api.hasKey ? (
          <span className="admin-api-key-ok">密钥已就绪</span>
        ) : (
          <span className="admin-api-key-miss">未检测到密钥</span>
        )}
      </div>
    </section>
  );
}

type DocsDocTab = 'help' | 'terms' | 'privacy';

function DocsEditor({
  docs,
  busy,
  onChange,
  onSave,
}: {
  docs: SiteDocs;
  busy: boolean;
  onChange: (docs: SiteDocs) => void;
  onSave: () => void;
}) {
  const [docTab, setDocTab] = useState<DocsDocTab>('help');
  const set = (patch: Partial<SiteDocs>) => onChange({ ...docs, ...patch });

  return (
    <div className="admin-docs">
      <div className="admin-docs-switch" role="tablist" aria-label="文档类型">
        <button
          type="button"
          role="tab"
          aria-selected={docTab === 'help'}
          className={docTab === 'help' ? 'active' : ''}
          onClick={() => setDocTab('help')}
        >
          帮助中心
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={docTab === 'terms'}
          className={docTab === 'terms' ? 'active' : ''}
          onClick={() => setDocTab('terms')}
        >
          用户须知
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={docTab === 'privacy'}
          className={docTab === 'privacy' ? 'active' : ''}
          onClick={() => setDocTab('privacy')}
        >
          隐私协议
        </button>
      </div>

      <section className="admin-docs-card">
        {docTab === 'help' && (
          <>
            <div className="admin-docs-card-head">
              <h3>帮助中心</h3>
              <p>展示在顶部「帮助」弹窗中</p>
            </div>
            <div className="field">
              <label className="field-label">标题</label>
              <input
                className="input"
                value={docs.helpTitle}
                onChange={(e) => set({ helpTitle: e.target.value })}
              />
            </div>
            <div className="field">
              <label className="field-label">副标题</label>
              <input
                className="input"
                value={docs.helpSubtitle}
                onChange={(e) => set({ helpSubtitle: e.target.value })}
              />
            </div>
            <div className="field">
              <label className="field-label">正文</label>
              <textarea
                className="admin-docs-textarea"
                rows={14}
                value={docs.helpBody}
                onChange={(e) => set({ helpBody: e.target.value })}
                placeholder="支持多行纯文本"
              />
            </div>
          </>
        )}

        {docTab === 'terms' && (
          <>
            <div className="admin-docs-card-head">
              <h3>用户须知</h3>
              <p>注册页可点击弹窗查看，需勾选同意后才能注册</p>
            </div>
            <div className="field">
              <label className="field-label">标题</label>
              <input
                className="input"
                value={docs.termsTitle}
                onChange={(e) => set({ termsTitle: e.target.value })}
              />
            </div>
            <div className="field">
              <label className="field-label">正文</label>
              <textarea
                className="admin-docs-textarea"
                rows={14}
                value={docs.termsBody}
                onChange={(e) => set({ termsBody: e.target.value })}
                placeholder="支持多行纯文本"
              />
            </div>
          </>
        )}

        {docTab === 'privacy' && (
          <>
            <div className="admin-docs-card-head">
              <h3>隐私协议</h3>
              <p>注册页可点击弹窗查看，需勾选同意后才能注册</p>
            </div>
            <div className="field">
              <label className="field-label">标题</label>
              <input
                className="input"
                value={docs.privacyTitle || '隐私协议'}
                onChange={(e) => set({ privacyTitle: e.target.value })}
              />
            </div>
            <div className="field">
              <label className="field-label">正文</label>
              <textarea
                className="admin-docs-textarea"
                rows={14}
                value={docs.privacyBody || ''}
                onChange={(e) => set({ privacyBody: e.target.value })}
                placeholder="支持多行纯文本"
              />
            </div>
          </>
        )}
      </section>

      <div className="admin-docs-actions">
        <button
          type="button"
          className="btn holo"
          disabled={busy}
          onClick={() => void onSave()}
        >
          {busy ? '保存中…' : '保存文档'}
        </button>
        {docs.updatedAt > 0 && (
          <span className="admin-docs-updated">
            上次保存：{formatTime(docs.updatedAt)}
          </span>
        )}
      </div>
    </div>
  );
}

function LimitEditor({
  disabled,
  unlimited,
  limit,
  used,
  onUnlimited,
  onLimit,
}: {
  disabled?: boolean;
  unlimited: boolean;
  limit: string;
  used: number;
  onUnlimited: (v: boolean) => void;
  onLimit: (v: string) => void;
}) {
  return (
    <div className="admin-limit">
      <div className="admin-limit-row">
        <label className="admin-limit-check">
          <input
            type="checkbox"
            checked={unlimited}
            disabled={disabled}
            onChange={(e) => onUnlimited(e.target.checked)}
          />
          不限
        </label>
        {unlimited ? (
          <span className="admin-limit-inf">∞</span>
        ) : (
          <input
            className="input admin-num"
            value={limit}
            disabled={disabled}
            onChange={(e) => onLimit(e.target.value.replace(/\D/g, ''))}
            aria-label="每日限额"
          />
        )}
      </div>
      <div className="admin-limit-used">今日已用 {used}</div>
    </div>
  );
}

function SponsorshipList({ items }: { items: SponsorshipRecord[] }) {
  if (!items.length) {
    return <div className="admin-empty">暂无赞助记录</div>;
  }
  return (
    <div className="admin-sponsor-list">
      {items.map((s) => (
        <div key={s.id} className="admin-sponsor-row">
          <div>
            <strong>¥{formatMoney(s.amount)}</strong>
            <span>{formatTime(s.createdAt)}</span>
          </div>
          <p>{s.message?.trim() ? s.message : '（无留言）'}</p>
        </div>
      ))}
    </div>
  );
}
