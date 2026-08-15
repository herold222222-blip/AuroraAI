import dotenv from 'dotenv';
import { applyHttpProxy } from './httpProxy';

/** Load .env then .env.local (local overrides; both gitignored for secrets). */
export function loadServerEnv() {
  dotenv.config({ path: '.env' });
  dotenv.config({ path: '.env.local', override: true });
  applyHttpProxy();
}
