import { Elysia } from 'elysia';

import type { DatabaseHandle } from '#api/db/client';
import type { AppDependencies } from '#api/dependencies';
import { createProfileRepository } from '#api/repositories/profile-repository';
import type { ProfileRepository } from '#api/repositories/profile-repository';
import { createReferenceRepository } from '#api/repositories/reference-repository';
import type { ReferenceRepository } from '#api/repositories/reference-repository';

/**
 * Per-request repository access. Each helper opens a database handle for this request only, runs
 * the operation, and always closes the handle; repositories never outlive the request.
 */
export function dataAccess(dependencies: AppDependencies) {
  async function withHandle<T>(operation: (handle: DatabaseHandle) => Promise<T>): Promise<T> {
    const handle = dependencies.openDatabase();
    try {
      return await operation(handle);
    } finally {
      await handle.close();
    }
  }

  return new Elysia({ name: 'data-access' })
    .decorate(
      'withReferences',
      <T>(operation: (repository: ReferenceRepository) => Promise<T>): Promise<T> =>
        withHandle((handle) => operation(createReferenceRepository(handle.db))),
    )
    .decorate(
      'withProfiles',
      <T>(operation: (repository: ProfileRepository) => Promise<T>): Promise<T> =>
        withHandle((handle) => operation(createProfileRepository(handle.db))),
    );
}
