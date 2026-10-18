import type { DatabaseHandle } from '#api/db/client';

export interface AppDependencies {
  /** Opens a database handle for one request; the caller must close it. */
  openDatabase: () => DatabaseHandle;
  /** Exact browser origins allowed by CORS, e.g. the Pages domain. */
  allowedOrigins: readonly string[];
}
