import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '.data');
const DATA_FILE = join(DATA_DIR, 'docs.json');

export interface SiteDocs {
  helpTitle: string;
  helpSubtitle: string;
  helpBody: string;
  termsTitle: string;
  termsBody: string;
  privacyTitle: string;
  privacyBody: string;
  updatedAt: number;
}

export const DEFAULT_DOCS: SiteDocs = {
  helpTitle: '帮助中心',
  helpSubtitle: 'Aurora 使用流程',
  helpBody: [
    '1. 上传一张 2D 景观意向图（支持 JPG / PNG / WEBP）。',
    '2. 点击「分析场景图层」，AI 自动拆分地形、植被、水体、构筑物等专业图层。',
    '3. 在 2D 智能色块工作台调整图层，发起 3D 模型生成。',
    '4. 在 3D 工作台执行拆分 / 合并 / 材质编辑，最终导出或同步至设计软件。',
    '5. 默认进入「未立项空间」。可用顶部下拉「新立项」保存当前工作；也可随时切回未立项空间或其它项目。',
    '6. 在未立项空间中，从模型同步到效果图，或从改图生成三维时，会弹框确认自动立项。',
    '7. 仅同一项目内模型截图与图片编辑互通。',
    '8. 访客可浏览页面；使用改图、图生模型等功能需登录或注册。如需帮助请联系万生 19806651984。',
    '',
    '提示：点击左上角 Aurora Logo 可清空当前项目并返回首页。',
  ].join('\n'),
  termsTitle: '用户须知',
  termsBody: [
    '欢迎使用 Aurora（灵曦万象人工智能）。注册并使用本平台前，请仔细阅读以下须知：',
    '',
    '1. 账号与安全',
    '您应妥善保管账号与密码，因账号保管不善造成的损失由您自行承担。禁止将账号出租、出借或转让给他人使用。',
    '',
    '2. 服务说明',
    '平台提供图像编辑、图生模型等 AI 辅助设计能力。功能可能随版本更新而调整；部分能力存在每日使用限额。',
    '',
    '3. 内容与合规',
    '您上传与生成的内容应合法合规，不得用于侵权、违法或损害他人权益的用途。平台有权对违规内容与账号采取限制措施。',
    '',
    '4. 数据与隐私',
    '我们会在提供服务所必需的范围内处理您的账号信息与使用记录。请勿上传涉密或敏感个人数据。',
    '',
    '5. 免责声明',
    'AI 生成结果仅供设计参考，不构成专业设计或工程结论。因使用生成结果造成的损失，平台在法律允许范围内不承担责任。',
    '',
    '6. 联系方式',
    '如需帮助，请联系万生 19806651984。',
    '',
    '点击同意即表示您已阅读并接受上述须知。',
  ].join('\n'),
  privacyTitle: '隐私协议',
  privacyBody: [
    'Aurora（灵曦万象人工智能）重视您的隐私保护。本协议说明我们如何收集、使用与保护您的个人信息。',
    '',
    '1. 我们收集的信息',
    '注册与使用过程中，我们可能收集：用户名、昵称、手机号码、头像、登录 IP/地区、功能使用次数，以及您主动提交的赞赏留言等。',
    '',
    '2. 信息使用目的',
    '上述信息用于账号识别与登录、服务提供与配额管理、安全风控、客户支持，以及在您同意范围内改进产品体验。',
    '',
    '3. 信息存储与保护',
    '我们采取合理的技术与管理措施保护您的信息安全，并仅在实现服务目的所必需的期限内保存相关数据。',
    '',
    '4. 信息共享',
    '未经您同意，我们不会向无关第三方出售您的个人信息。仅在法律法规要求、或为实现服务所必需（如云服务基础设施）时，可能进行必要共享。',
    '',
    '5. 您的权利',
    '您可通过账号设置修改昵称、头像与手机号；如需注销或其他隐私相关请求，请联系万生 19806651984。',
    '',
    '6. 协议更新',
    '我们可能适时更新本隐私协议，更新后将通过平台展示。继续使用即视为了解并接受更新内容。',
    '',
    '点击同意即表示您已阅读并接受本隐私协议。',
  ].join('\n'),
  updatedAt: 0,
};

function normalizeDocs(raw: Partial<SiteDocs> | null | undefined): SiteDocs {
  const base = { ...DEFAULT_DOCS };
  if (!raw || typeof raw !== 'object') return base;
  return {
    helpTitle: String(raw.helpTitle || base.helpTitle).slice(0, 80),
    helpSubtitle: String(raw.helpSubtitle || base.helpSubtitle).slice(0, 120),
    helpBody: String(raw.helpBody ?? base.helpBody).slice(0, 20000),
    termsTitle: String(raw.termsTitle || base.termsTitle).slice(0, 80),
    termsBody: String(raw.termsBody ?? base.termsBody).slice(0, 20000),
    privacyTitle: String(raw.privacyTitle || base.privacyTitle).slice(0, 80),
    privacyBody: String(raw.privacyBody ?? base.privacyBody).slice(0, 20000),
    updatedAt: Number(raw.updatedAt) || 0,
  };
}

async function readFileDocs(): Promise<SiteDocs> {
  try {
    if (!existsSync(DATA_FILE)) return { ...DEFAULT_DOCS };
    const raw = JSON.parse(readFileSync(DATA_FILE, 'utf8')) as SiteDocs;
    return normalizeDocs(raw);
  } catch {
    return { ...DEFAULT_DOCS };
  }
}

async function writeFileDocs(docs: SiteDocs): Promise<void> {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(docs, null, 2), 'utf8');
}

async function readBlobDocs(): Promise<SiteDocs | null> {
  try {
    const { getStore } = await import('@netlify/blobs');
    const store = getStore('aurora-docs');
    const raw = await store.get('site', { type: 'text' });
    if (!raw) return { ...DEFAULT_DOCS };
    return normalizeDocs(JSON.parse(raw) as SiteDocs);
  } catch {
    return null;
  }
}

async function writeBlobDocs(docs: SiteDocs): Promise<boolean> {
  try {
    const { getStore } = await import('@netlify/blobs');
    const store = getStore('aurora-docs');
    await store.set('site', JSON.stringify(docs));
    return true;
  } catch {
    return false;
  }
}

export async function loadDocs(): Promise<SiteDocs> {
  if (process.env.NETLIFY === 'true' || process.env.NETLIFY_BLOBS) {
    const blob = await readBlobDocs();
    if (blob) return blob;
  }
  return readFileDocs();
}

export async function saveDocs(
  patch: Partial<
    Pick<
      SiteDocs,
      | 'helpTitle'
      | 'helpSubtitle'
      | 'helpBody'
      | 'termsTitle'
      | 'termsBody'
      | 'privacyTitle'
      | 'privacyBody'
    >
  >,
): Promise<SiteDocs> {
  const current = await loadDocs();
  const next = normalizeDocs({
    ...current,
    ...patch,
    updatedAt: Date.now(),
  });
  const usedBlob = await writeBlobDocs(next);
  if (!usedBlob) await writeFileDocs(next);
  return next;
}
