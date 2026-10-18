import type { DatabaseHandle } from '#api/db/client';
import type { FetchUpstream } from '#api/services/live-conditions';

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
}
