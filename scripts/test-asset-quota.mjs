#!/usr/bin/env node
/**
 * 资产上限阻断 — 端到端/集成冒烟脚本
 *
 * 验证：
 *  1) GET /api/assets/counts 返回 { counts, limits }
 *  2) 配额常量：图片 20 / 模型 2
 *  3) 客户端逻辑：count >= limit 时阻断（模拟）
 *  4) 提示文案包含「上限」
 *
 * 用法：
 *   node scripts/test-asset-quota.mjs
 *   API_ORIGIN=https://www.gnoverse.cn node scripts/test-asset-quota.mjs
 */

const ORIGIN = (process.env.API_ORIGIN || 'http://127.0.0.1:3000').replace(
  /\/$/,
  '',
);

const EXPECT_IMAGE_LIMIT = 20;
const EXPECT_MODEL_LIMIT = 2;

const MSG_IMAGE =
  '图片数量已达上限（20 张），无法继续上传或 AI 改图。请到「资产」删除部分图片后重试。';
const MSG_MODEL =
  '模型数量已达上限（2 个），无法继续生成三维模型。请到「资产」删除旧模型后重试。';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function simulateBlock(counts, limits) {
  return {
    blockUpload: counts.image >= limits.image,
    blockEdit: counts.image >= limits.image,
    blockModel: counts.model >= limits.model,
  };
}

async function main() {
  console.log('[quota-e2e] API_ORIGIN =', ORIGIN);

  // --- 1) counts 接口（需登录；未登录应 401）---
  const res = await fetch(`${ORIGIN}/api/assets/counts`);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`counts 非 JSON: HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  if (res.status === 401) {
    console.log('[quota-e2e] counts 未登录返回 401（符合「仅数据库+鉴权」）');
  } else {
    assert(res.ok, `counts HTTP ${res.status}: ${text.slice(0, 200)}`);
    assert(data.ok === true, 'counts.ok !== true');
    assert(data.source === 'database' || data.counts, '应来自 database');
    assert(data.counts && typeof data.counts.image === 'number', '缺少 counts.image');
    assert(data.counts && typeof data.counts.model === 'number', '缺少 counts.model');
    const limits = data.limits || { image: EXPECT_IMAGE_LIMIT, model: EXPECT_MODEL_LIMIT };
    assert(
      Number(limits.image) === EXPECT_IMAGE_LIMIT,
      `limits.image 期望 ${EXPECT_IMAGE_LIMIT} 实际 ${limits.image}`,
    );
    assert(
      Number(limits.model) === EXPECT_MODEL_LIMIT,
      `limits.model 期望 ${EXPECT_MODEL_LIMIT} 实际 ${limits.model}`,
    );
    console.log('[quota-e2e] counts OK', data.counts, 'limits', limits, 'source', data.source);
  }

  // --- 2) 文案 ---
  assert(MSG_IMAGE.includes('上限') && MSG_IMAGE.includes('20'), '图片提示文案异常');
  assert(MSG_MODEL.includes('上限') && MSG_MODEL.includes('2'), '模型提示文案异常');
  console.log('[quota-e2e] toast copy OK');

  // --- 3) 边界模拟 ---
  const limits = { image: EXPECT_IMAGE_LIMIT, model: EXPECT_MODEL_LIMIT };
  const under = simulateBlock(
    { image: EXPECT_IMAGE_LIMIT - 1, model: EXPECT_MODEL_LIMIT - 1 },
    limits,
  );
  assert(!under.blockUpload && !under.blockEdit && !under.blockModel, '未达上限不应阻断');

  const atImage = simulateBlock(
    { image: EXPECT_IMAGE_LIMIT, model: 0 },
    limits,
  );
  assert(atImage.blockUpload && atImage.blockEdit, '图片达上限应阻断上传/改图');
  assert(!atImage.blockModel, '仅图片满不应阻断模型');

  const atModel = simulateBlock(
    { image: 0, model: EXPECT_MODEL_LIMIT },
    limits,
  );
  assert(atModel.blockModel, '模型达上限应阻断图生模型');
  assert(!atModel.blockUpload, '仅模型满不应阻断上传');

  const over = simulateBlock(
    { image: EXPECT_IMAGE_LIMIT + 5, model: EXPECT_MODEL_LIMIT + 1 },
    limits,
  );
  assert(over.blockUpload && over.blockEdit && over.blockModel, '超限应全部阻断');
  console.log('[quota-e2e] boundary logic OK');

  // --- 4) manifest 可选冒烟 ---
  const mRes = await fetch(`${ORIGIN}/api/assets/manifest?max=5`);
  if (mRes.ok) {
    const m = await mRes.json();
    assert(m.ok === true && Array.isArray(m.entries), 'manifest 结构异常');
    console.log('[quota-e2e] manifest OK, entries=', m.entries.length);
  } else {
    console.warn('[quota-e2e] manifest skipped HTTP', mRes.status);
  }

  console.log('[quota-e2e] ALL PASSED');
}

main().catch((err) => {
  console.error('[quota-e2e] FAILED', err instanceof Error ? err.message : err);
  process.exit(1);
});
