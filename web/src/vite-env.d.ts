/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Mapbox GL access token (pk.*). Set in web/.env.local (gitignored). */
  readonly VITE_MAPBOX_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
