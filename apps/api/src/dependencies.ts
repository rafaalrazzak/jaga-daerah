import type { DatabaseHandle } from '#api/db/client';
import type { FetchUpstream } from '#api/services/live-conditions';

/** Minimal fetch surface used by the assistant proxy, so tests need no Bun-only properties. */
export type AssistantFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface AppDependencies {
  /** Opens a database handle for one request; the caller must close it. */
  openDatabase: () => DatabaseHandle;
  /** Exact browser origins allowed by CORS, e.g. the Pages domain. */
  allowedOrigins: readonly string[];
  /** Reads an official live feed (BMKG, NASA FIRMS); the Worker caches it at the edge. */
  fetchUpstream: FetchUpstream;
  /** NASA FIRMS MAP_KEY secret; unset switches hotspots to the keyless MODIS file. */
  firmsMapKey: string | undefined;
  /** Bearer token for the public ISPU list. Unset leaves the air block unconfigured. */
  ispuApiToken?: string | undefined;
  /** OpenRouter credential. Server-side only: the browser never receives this value. */
  openRouterApiKey?: string | undefined;
  /** OpenRouter model; falls back to the assistant default when unset. */
  openRouterModel?: string | undefined;
  /** Injected by tests; production uses the platform fetch. */
  fetchAssistant?: AssistantFetch | undefined;
}
