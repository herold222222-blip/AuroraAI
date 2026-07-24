import dotenv from 'dotenv';
import { createApiApp } from './app';

dotenv.config();

const port = Number(process.env.PORT || 3000);
const app = createApiApp();
app.listen(port, () => {
  console.log(`[aurora-api] http://localhost:${port}`);
});
