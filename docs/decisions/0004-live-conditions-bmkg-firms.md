# 0004 — Live conditions from BMKG and NASA FIRMS

## Status

Accepted — 18 October 2026, by repository owner decision, accepting a documented reuse risk (see Context). Supersedes, for live feeds only, the exclusion recorded in `tools/etl/README.md` ("BMKG earthquake data: investigated and excluded on the publisher's terms"); that section still governs the static `nature.json` artifact.

Reconfirmed by the owner on 18 October 2026 after the feature's files were removed by an unidentified process outside the working session; the owner stated the removal was not theirs and asked for a full restore.

## Context

The owner asked for today's weather, early warnings, and a high-priority warning when a disaster is under way (including forest fires) on every region profile, with a selectable kecamatan and a kecamatan map.

Sources checked on 18 October 2026:

- BMKG open-data forecast `https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4=…` (documented on `https://data.bmkg.go.id/prakiraan-cuaca/`): JSON, CORS `*`, 3-hour steps for 3 days, 60 requests/minute/IP, and "Wajib untuk mencantumkan BMKG" as the stated condition. It accepts only `adm4` (kelurahan/desa); `adm3`/`adm2` redirect.
- BMKG nowcast early warnings `https://www.bmkg.go.id/alerts/nowcast/id`: RSS index (`<copyright>public domain</copyright>`) linking one CAP 1.2 document per warning; area is the province plus kecamatan names in the description.
- BMKG earthquakes `https://data.bmkg.go.id/DataMKG/TEWS/{autogempa,gempaterkini,gempadirasakan}.json`.
- NASA FIRMS: area API (needs a free MAP_KEY) and keyless public 24-hour regional files. NASA asks for the FIRMS acknowledgement and provides data "as is".
- SiPongi (KLHK): no documented public API found, not used.

BMKG's Ketentuan Penggunaan (`https://www.bmkg.go.id/ketentuan-penggunaan`, updated 8 July 2026) §9.3: "Pengemasan ulang, integrasi ke aplikasi pihak ketiga, atau penggunaan data untuk tujuan komersial wajib melalui izin tertulis resmi dari BMKG." §4.5 requires machine-to-machine access through the official API; §9.1 requires the attribution "Sumber: BMKG"; §8.4/§9.2 require products to be shown whole, without cropping. No written permission is held.

The owner chose to ship on the basis of BMKG's open-data portal (official API, attribution as its stated condition), accepting the residual risk that §9.3 is read as requiring written permission. This is a risk accepted by the owner, not a legal conclusion. If BMKG objects or states terms that forbid this use, the BMKG feeds are switched off and the section links to bmkg.go.id instead.

## Decision

- `GET /v1/daerah/:slug/terkini?kecamatan=` reads the four feeds at request time through the Worker. Upstream responses are edge-cached (forecast 30 min, warnings 5 min, earthquakes 2 min, hotspots 15 min) so visitors never hit BMKG or FIRMS directly; the response itself is cached 1–2 minutes without stale-while-revalidate. `GET /v1/terkini` is the country brief for the landing page: the same earthquake files without a distance filter (five newest), the nowcast index headlines only, and the KLH/BPLH ISPU station list (`https://ispu.kemenlh.go.id/apiweb/stasiun`, cached 5 min). The ISPU call sends `ISPU_API_TOKEN` (Worker secret; locally git-ignored `apps/api/.dev.vars`; never committed). Without the token the air block is `not_configured` and links to ispu.kemenlh.go.id. Station names, values, critical parameters, and category text are kept; addresses and coordinates are not. Stations are not matched to Kemendagri codes. Advice text is the wording the ISPU application publishes for each category.
- Only official API/feed URLs are read; no page is scraped, and no bot challenge is bypassed.
- Each feed reports `ok`, `unavailable`, or `not_configured` on its own. The UI never says "aman" or "tidak ada bencana": with an `ok` feed and no item it says no active BMKG warning was found for the region at the time checked; with a failed feed it says the feed could not be read and links to BMKG.
- Warnings are matched to a region only when the CAP area names the region's province and the description names one of its kecamatan (exact normalized names from the Kemendagri list). Matched kecamatan are listed. BMKG text is shown whole and unchanged, with "Sumber: BMKG", the issue/expiry time, and a link to the CAP document.
- The forecast is for one reference kelurahan/desa per kecamatan (the lowest-coded desa, `jaga_etl.live_points`); the visitor may pick any kecamatan of the region (validated server-side) and the UI always names the desa and kecamatan.
- Earthquakes are listed within 200 km of the region's reference point over 72 hours, as BMKG wrote them, with epicentre coordinates; no risk or tsunami inference is added.
- Hotspots: with `FIRMS_MAP_KEY` (a Worker secret; locally the git-ignored `apps/api/.dev.vars`, never committed) the Worker uses the VIIRS S-NPP area API for the region's bounding box; without it, FIRMS' keyless 24-hour MODIS file for South-East Asia filtered to the box. The web then keeps only detections inside the kecamatan outlines and names their kecamatan. Hotspots are labelled as satellite detections that are not confirmed fires, with NASA's acknowledgement.
- The kecamatan map uses static outlines from `jaga_etl.kecamatan_maps` (cahyadsn/wilayah_boundaries, MIT), simplified for display, not legal boundaries.
- Nothing is stored in PostgreSQL; live data is not a published dataset.

## Alternatives considered

- Feature flag off until BMKG permission arrives: offered, declined by the owner.
- Drop BMKG and keep only FIRMS: declined.
- Browser calling BMKG directly: works for the forecast (CORS `*`) but not for the nowcast feed, and would expose every visitor to BMKG's rate limit.

## Consequences

- Profiles depend on third-party uptime for one block only; every other module is unaffected.
- The Worker bundles `src/data/live-points.json` (~1.27 MB raw, ~181 KB gzip: 514 regions, 7,285 kecamatan with reference desa).
- Each uncached live request makes up to 16 subrequests (1 forecast, 1 RSS, ≤10 CAP, 3 earthquake files, 1 FIRMS), within Workers limits.
- The web serves 514 kecamatan map files (~4.5 MB total, median ~7.6 KB) as static assets.

## Migration

None: no schema change. Set `FIRMS_MAP_KEY` with `wrangler secret put` per environment to use VIIRS instead of MODIS.

## Rollback

Remove the `LiveConditions` island from the profile page and the `createLiveRoutes` registration; no data migration is involved.
