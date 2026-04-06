/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AV_KEY: string;
  readonly VITE_FINNHUB_KEY: string;
  readonly VITE_API_BASE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
