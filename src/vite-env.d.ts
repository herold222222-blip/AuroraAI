/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API 域名，如 https://www.gnoverse.cn */
  readonly VITE_API_ORIGIN: string;
  /** 开发态：是否把 /api 代理到 VITE_API_ORIGIN */
  readonly VITE_DEV_PROXY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
