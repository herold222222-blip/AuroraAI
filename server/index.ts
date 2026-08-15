import { loadServerEnv } from './loadEnv';
import { createApiApp } from './app';
import { getWechatPayConfig } from './wechatPay';

loadServerEnv();

const port = Number(process.env.PORT || 3000);
const app = createApiApp();
app.listen(port, () => {
  console.log(`[aurora-api] http://localhost:${port}`);
  const wx = getWechatPayConfig();
  if (wx) {
    console.log('[pay] wechat notify_url=', wx.notifyUrl);
  } else {
    console.warn('[pay] wechat config incomplete — native pay disabled');
  }
});
