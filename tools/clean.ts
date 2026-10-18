import { lstat, realpath, rm } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const ALLOWED_TARGETS = [
  'apps/web/dist',
  'apps/web/.astro',
  'apps/api/.wrangler',
  'apps/api/dist',
  'coverage',
  'playwright-report',
  'test-results',
  'apps/web/playwright-report',
  'apps/web/test-results',
] as const;

const PROTECTED_NAMES = new Set([
  '.env',
  '.git',
  'bun.lock',
  'database',
  'node_modules',
  'src',
  'tools/etl/data/raw',
]);

const workspaceRoot = await realpath(process.cwd());
const packageJsonPath = resolve(workspaceRoot, 'package.json');
const packageJson = await Bun.file(packageJsonPath).json();

if (packageJson.name !== 'jaga-daerah') {
  throw new Error('Refusing to clean: run this command from the JagaDaerah repository root.');
}

function assertSafeTarget(relativeTarget: string): string {
  if (isAbsolute(relativeTarget) || PROTECTED_NAMES.has(relativeTarget)) {
    throw new Error(`Refusing unsafe clean target: ${relativeTarget}`);
  }

  const absoluteTarget = resolve(workspaceRoot, relativeTarget);
  const pathFromRoot = relative(workspaceRoot, absoluteTarget);

  if (
    pathFromRoot === '' ||
    pathFromRoot === '..' ||
    pathFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRoot)
  ) {
    throw new Error(`Clean target escapes the repository: ${relativeTarget}`);
  }

  return absoluteTarget;
}

await Promise.all(
  ALLOWED_TARGETS.map(async (relativeTarget) => {
    const absoluteTarget = assertSafeTarget(relativeTarget);

    try {
      const targetStats = await lstat(absoluteTarget);

      if (targetStats.isSymbolicLink()) {
        throw new Error(`Refusing to remove symbolic link: ${relativeTarget}`);
      }

      await rm(absoluteTarget, { force: true, recursive: true });
      console.info(`Removed ${relativeTarget}`);
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return;
      }

      throw error;
    }
  }),
);
