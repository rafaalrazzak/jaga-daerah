import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sitemap from '@astrojs/sitemap';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

function parseEnvFile(filePath: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!fs.existsSync(filePath)) return result;
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        result[key] = val;
      }
    }
  } catch {
    // Ignore read errors
  }
  return result;
}

const configDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(configDir, '../..');
const loadedEnv = {
  ...parseEnvFile(path.join(repoRoot, '.env')),
  ...parseEnvFile(path.join(repoRoot, '.env.local')),
  ...parseEnvFile(path.join(configDir, '.env')),
};

const openRouterKey =
  process.env.OPENROUTER_API_KEY ||
  process.env.PUBLIC_OPENROUTER_API_KEY ||
  loadedEnv.OPENROUTER_API_KEY ||
  loadedEnv.PUBLIC_OPENROUTER_API_KEY ||
  '';

const openRouterModel =
  process.env.OPENROUTER_MODEL ||
  process.env.PUBLIC_OPENROUTER_MODEL ||
  loadedEnv.OPENROUTER_MODEL ||
  loadedEnv.PUBLIC_OPENROUTER_MODEL ||
  'minimax/minimax-m3.1-flash';

// The production domain is not decided yet (PRD §16), so it comes from the build environment instead
// of being hardcoded. An unset or invalid value must still build — without a canonical URL, og:url,
// or sitemap pointing at a guessed host.
let siteUrl: string | undefined;
try {
  const parsed = new URL(process.env['PUBLIC_SITE_URL'] ?? loadedEnv['PUBLIC_SITE_URL'] ?? '');
  // Origin only: each page appends its own path, so a deep path here would corrupt every URL.
  if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
    siteUrl = parsed.origin;
  }
} catch {
  // Unset or not a URL: leave `site` undefined so nothing absolute is emitted.
}

if (!siteUrl) {
  console.warn(
    'PUBLIC_SITE_URL is unset or not an http(s) URL: skipping the sitemap and every absolute canonical/social URL.',
  );
}

// Static output is served directly by Cloudflare Pages; React only hydrates explicit islands.
export default defineConfig({
  output: 'static',
  ...(siteUrl ? { site: siteUrl } : {}),
  integrations: [...(siteUrl ? [sitemap()] : []), react()],
  vite: {
    plugins: [tailwindcss()],
    envDir: '../../',
    define: {
      'import.meta.env.PUBLIC_OPENROUTER_API_KEY': JSON.stringify(openRouterKey),
      'import.meta.env.PUBLIC_OPENROUTER_MODEL': JSON.stringify(openRouterModel),
      'import.meta.env.OPENROUTER_API_KEY': JSON.stringify(openRouterKey),
      'import.meta.env.OPENROUTER_MODEL': JSON.stringify(openRouterModel),
    },
  },
});
