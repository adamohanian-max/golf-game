/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Mapbox GL access token (pk.*). Set in web/.env.local (gitignored). */
  readonly VITE_MAPBOX_TOKEN?: string;
  /** Google Maps Platform key with Map Tiles API enabled. web/.env.local. */
  readonly VITE_GOOGLE_MAPS_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
