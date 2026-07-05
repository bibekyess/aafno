/// <reference types="vite/client" />

// Build-time define injected by vite.config.ts (ADR: dev-cloud-compile-time-exclusion).
declare const __DEV_CLOUD__: boolean;

interface ImportMetaEnv {
  readonly VITE_DEV_CLOUD_BASE_URL?: string;
  readonly VITE_DEV_CLOUD_MODEL?: string;
  readonly VITE_DEV_CLOUD_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
