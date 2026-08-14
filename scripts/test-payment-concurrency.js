#!/usr/bin/env node
/**
 * 并发回调测试脚本（用于本地/测试环境）
 *
 * 用法：
 *   export TARGET='http://127.0.0.1:3000/api/pay/notify'
 *   node scripts/test-payment-concurrency.js <outTradeNo> <transactionId>
 *
 * 会并发触发 8 个回调请求，帮助验证幂等性和重复插入保护。
 */

const fetch = require('node-fetch');

const TARGET = process.env.TARGET || 'http://127.0.0.1:3000/api/pay/notify';
const [,, outTradeNo, transactionId] = process.argv;
if (!outTradeNo || !transactionId) {
  console.error('Usage: node scripts/test-payment-concurrency.js <outTradeNo> <transactionId>');
  process.exit(2);
}

const payload = {
  out_trade_no: outTradeNo,
  transaction_id: transactionId,
  amount_total: 1,
  trade_state: 'SUCCESS'
};

async function sendOne(i) {
  try {
    const res = await fetch(TARGET, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    console.log(`#${i} -> ${res.status}: ${text.slice(0,200)}`);
  } catch (e) {
    console.error(`#${i} error`, e.message);
  }
}

(async () => {
  const concurrency = 8;
  const tasks = [];
  for (let i = 0; i < concurrency; i++) tasks.push(sendOne(i + 1));
  await Promise.all(tasks);
  console.log('done');
})();
