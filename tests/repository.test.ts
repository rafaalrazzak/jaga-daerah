import { describe, expect, test } from 'bun:test';

const REQUIRED_FILES = [
  'AGENTS.md',
  'CLAUDE.md',
  'PRD.md',
  'PROJECT_STATUS.md',
  'README.md',
  'CONTRIBUTING.md',
  'docs/ARCHITECTURE.md',
  'docs/CODE_STANDARDS.md',
  'docs/DEVELOPMENT.md',
  'docs/IMPLEMENTATION_PLAN.md',
  'docs/prompts/START_PROJECT.md',
  'docs/SECURITY.md',
  'docs/TESTING.md',
] as const;

describe('repository foundation', () => {
  test('uses the locked project identity and package manager', async () => {
    const packageJson = await Bun.file('package.json').json();

    expect(packageJson.name).toBe('jaga-daerah');
    expect(packageJson.private).toBe(true);
    expect(packageJson.packageManager).toBe('bun@1.4.2');
  });

  test.each(REQUIRED_FILES)('%s exists and is not empty', async (filePath) => {
    const file = Bun.file(filePath);

    expect(await file.exists()).toBe(true);
    expect(file.size).toBeGreaterThan(0);
  });

  test('documents the locked formatter and linter', async () => {
    const agentInstructions = await Bun.file('AGENTS.md').text();

    expect(agentInstructions).toContain('Formatter: Oxfmt only.');
    expect(agentInstructions).toContain('Linter: Oxlint only.');
  });

  test('locks Drizzle as the PostgreSQL data-access layer', async () => {
    const agentInstructions = await Bun.file('AGENTS.md').text();
    const productRequirements = await Bun.file('PRD.md').text();

    expect(agentInstructions).toContain('Drizzle ORM');
    expect(agentInstructions).toContain(
      'never use `drizzle-kit push` against staging or production',
    );
    expect(productRequirements).toContain(
      'Drizzle ORM adalah satu-satunya data-access layer aplikasi',
    );
  });

  test('documents one-way module boundaries and risk-based testing', async () => {
    const codeStandards = await Bun.file('docs/CODE_STANDARDS.md').text();
    const testingStrategy = await Bun.file('docs/TESTING.md').text();

    expect(codeStandards).toContain('Dependency direction');
    expect(codeStandards).toContain('Drizzle ORM is the exclusive application query layer.');
    expect(testingStrategy).toContain('Testing follows risk and observable behavior.');
    expect(testingStrategy).toContain('Drizzle migration consistency check');
  });

  test('exposes no drizzle-kit push path through package scripts', async () => {
    const manifests = await Promise.all(
      ['package.json', 'apps/api/package.json'].map((path) => Bun.file(path).json()),
    );
    const scripts = manifests.flatMap((manifest) => Object.values(manifest.scripts ?? {}));

    expect(scripts.some((script) => String(script).includes('push'))).toBe(false);
    expect(scripts).toContain('drizzle-kit generate');
    expect(scripts).toContain('drizzle-kit check');
  });

  test('gives Claude one active milestone with bounded startup instructions', async () => {
    const claudeInstructions = await Bun.file('CLAUDE.md').text();
    const projectStatus = await Bun.file('PROJECT_STATUS.md').text();
    const implementationPlan = await Bun.file('docs/IMPLEMENTATION_PLAN.md').text();

    expect(claudeInstructions).toContain('@AGENTS.md');
    expect(claudeInstructions).toContain('begin only with the current milestone');
    expect(projectStatus).toContain('Milestone 1 — Workspace Bootstrap');
    expect(implementationPlan).toContain('Complete milestones in order');
    expect(claudeInstructions).toContain('Never deploy production');
  });
});
