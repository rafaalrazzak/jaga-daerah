# Security

## Security Objective

Protect data integrity, infrastructure credentials, and public trust while serving a read-only transparency application. The product requires no accounts and collects no user data; the only personal data it handles is the limited public record described under Personal Data (LHKPN).

## Threat Model

Primary risks:

- injection through search, slug, filters, or imported spreadsheets;
- leaked Worker/database secrets;
- malicious or malformed upstream files;
- stale, partial, or incorrectly mapped public data;
- exposure of personal identifiers, or accusatory framing, in the officials' wealth data;
- cross-site scripting from source-derived text;
- CORS/cache misconfiguration;
- abusive automated traffic and expensive queries;
- vulnerable or compromised dependencies/workflows;
- accidental destructive cleanup or migration.

## Required Controls

### Browser

- Render source data as text, not raw HTML.
- Use a restrictive CSP; avoid `unsafe-eval` and uncontrolled `unsafe-inline`.
- Configure HSTS after the production domain is stable.
- Set `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, and `frame-ancestors` policy.
- Use `noopener noreferrer` for external new-tab links.
- Do not store search history or identifiers without a documented need.

### API

- Public application routes are read-only.
- Validate length, shape, allowed characters, ranges, and pagination limits.
- Use exact CORS origin allowlists and no credentialed public requests.
- Use Drizzle query builders or Drizzle's parameterized `sql` template only; never interpolate untrusted values into raw SQL or identifiers.
- Limit response size, query cost, and rate where necessary.
- Return generic internal errors with request IDs; log details only server-side.
- Do not expose dependency versions or database health details from `/health`.

### Database

- Separate runtime read-only, ETL write, and migration roles.
- Use connection, statement, and idle timeouts.
- Do not run long transactions from Worker requests.
- Apply backward-compatible migrations before dependent code.
- Apply only reviewed Drizzle migration files in shared environments; `drizzle-kit push` is prohibited for staging and production.
- Back up and test restoration before final release.

### ETL

- Treat every file as untrusted input.
- Enforce file-size and expected-format limits.
- Never execute spreadsheet formulas or embedded content.
- Keep immutable raw inputs with checksums and provenance.
- Reject invalid rows and publish only an entirely validated dataset version.

### Personal Data (LHKPN)

The profile's wealth section publishes declared wealth figures for regional officials. The product still has no accounts and no user data; the rules below cover the officials, who are the only natural persons this repository processes.

- Publish only what KPK itself publishes: the official's public name, the officially stated position, and the declared asset and debt figures for one reporting year. Nothing else.
- Never store NIK, address, date of birth, report ID, tax identifiers, family-member details, document scans, or any other identifier beyond the public name and position, even when the upstream record contains it. Drop those fields at extraction; do not carry them into staging, contracts, responses, or logs.
- Every stored figure carries its reporting year, the position at that reporting year, the source identity or URL, and the download/processing date. A record missing any of these is rejected, not displayed.
- Acquiring the data must not bypass a CAPTCHA, bot challenge, WAF, or login. No fabricated or estimated figure is stored or shown. If no official source exists for a figure, the section shows unavailable, not a guess.
- The API response exposes only the fields the profile renders. Do not return raw upstream records, and do not accept arbitrary official identifiers from the client.
- Refresh ties to source publication and to the mapping review, not to a fixed schedule: figures are updated when a new official publication is processed, and served data is invalidated on activation of a new dataset version like other facts.
- Retention is bounded to what is shown: keep only the reporting years that the profile displays, plus the pinned source snapshot and its provenance. Delete intermediate extraction dumps and superseded rows when a dataset version is retired, so the serving tables do not accumulate personal records beyond published scope.
- Attribution is mandatory: name KPK as the publisher, link the official publication, and state that the figure is not an audit result. The reuse basis is the owner's recorded decision, not a licence: as of 17 October 2026 no reuse or redistribution grant was found in KPK's public materials (its e-LHKPN privacy notice describes the mandated announcement and the site footer reserves all rights), so the section carries a known residual reuse risk. If KPK states terms that forbid republication, stop publishing and revert the section to link-out.
- Deletion requests and other data-subject requests follow the incident-response path below: stop publishing the affected record first, then assess.

### Secrets and Supply Chain

- Store production secrets in Cloudflare/provider secret stores.
- Never commit `.env`, tokens, credentials, dumps, or production data.
- Pin important tools and CI actions to reviewed versions.
- Use least-privilege CI permissions and protected production environments.
- Run dependency and secret scanning before release.

## Security Headers Baseline

The exact CSP depends on final asset/font/analytics choices. Start from:

```text
default-src 'self';
base-uri 'self';
object-src 'none';
frame-ancestors 'none';
form-action 'self';
script-src 'self';
style-src 'self';
img-src 'self' data: https:;
font-src 'self';
connect-src 'self' https://api.jagadaerah.id https://basemaps.cartocdn.com https://*.basemaps.cartocdn.com;
worker-src 'self';
upgrade-insecure-requests;
```

The landing choropleth loads CARTO vector tiles (`basemaps.cartocdn.com` and its tile subdomains) and draws official kabupaten/kota polygons on top. The MapLibre worker is a same-origin file, so `script-src` stays `'self'` and `worker-src` is `'self'`. Do not add a public script host for that worker.

Do not copy this into production unchanged if the final domain or asset policy differs. Tighten it after observing required resources in preview.

## Incident Response

1. Confirm scope using request IDs and metrics.
2. Stop dataset publication and risky deployments.
3. Rotate exposed credentials immediately.
4. Roll back Worker/application or activate the last healthy dataset version.
5. Preserve relevant logs without spreading secrets.
6. Document impact, timeline, root cause, and preventive action.

## Reporting

A private vulnerability-reporting contact must be added before public launch. Until then, contact the repository owner privately and do not publish exploit details.
