import { loadServerEnv } from './loadEnv';
import { createApiApp } from './app';

loadServerEnv();

const port = Number(process.env.PORT || 3000);
const app = createApiApp();
app.listen(port, () => {
  console.log(`[aurora-api] http://localhost:${port}`);
});
