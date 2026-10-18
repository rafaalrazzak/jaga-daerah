interface ImportMetaEnv {
  /** API origin without the version path, e.g. https://api.jagadaerah.id (routes add /v1). */
  readonly PUBLIC_API_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
