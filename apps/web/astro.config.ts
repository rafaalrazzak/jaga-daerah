import sitemap from '@astrojs/sitemap';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

// The production domain is not decided yet (PRD §16), so it comes from the build environment instead
// of being hardcoded. An unset or invalid value must still build — without a canonical URL, og:url,
// or sitemap pointing at a guessed host.
let siteUrl: string | undefined;
try {
  const parsed = new URL(process.env['PUBLIC_SITE_URL'] ?? '');
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
  },
});
