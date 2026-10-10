/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional absolute API origin, e.g. http://localhost:8787. Leave unset to use same-origin /api (Vite proxy). */
  readonly VITE_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
