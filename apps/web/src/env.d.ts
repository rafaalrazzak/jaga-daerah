interface ImportMetaEnv {
  /** API origin without the version path, e.g. https://api.jagadaerah.id (routes add /v1). */
  readonly PUBLIC_API_ORIGIN?: string;
  /** OpenRouter API key for LLM chatbot integration. */
  readonly OPENROUTER_API_KEY?: string;
  /** OpenRouter Model ID (e.g. minimax/minimax-m3.1-flash:free). */
  readonly OPENROUTER_MODEL?: string;
  readonly PUBLIC_OPENROUTER_API_KEY?: string;
  readonly PUBLIC_OPENROUTER_MODEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
