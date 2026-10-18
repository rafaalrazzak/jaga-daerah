# JagaDaerah ETL

Python ETL, isolated from the application runtime. Managed with [uv](https://docs.astral.sh/uv/); dependencies are pinned in `pyproject.toml` and `uv.lock`.

```sh
bun run test:etl                                   # unit tests (offline) + PostgreSQL publish tests (disposable cluster)
bun run etl:regions                                # region codes: extract + normalize + quality gate, no writes
bun run etl:regions -- --load                      # ... and upsert (needs ETL_DATABASE_URL)
bun run etl:fetch -- --years 2024,2025             # download sealed DJPK + BNPB snapshots (network, ~1 req/s)
bun run etl:publish -- --djpk <dir> --bnpb <dir>   # quality gate only (reads reference tables)
bun run etl:publish -- --djpk <dir> --bnpb <dir> --load   # stage, verify, activate a dataset version
bun run etl:expenditure                            # expenditure breakdown JSON for the static profile page (offline)
uv run python -m jaga_etl.boundaries --output ../../apps/web/public/data/map-regions.json  # map outlines (from tools/etl)
bun run etl:kecamatan-maps                         # per-region kecamatan maps (fetches the pinned files once)
```

Raw snapshots live in `data/raw/` and reports in `reports/` (both gitignored). `ETL_DATABASE_URL` must use the `jaga_etl` role (`database/roles/etl-writer.sql`).

## LHKPN wealth figures (`jaga_etl.lhkpn`)

Builds `apps/web/src/data/lhkpn.json`: declared wealth totals published by KPK for the regional heads in office, attached to a region through a reviewed institution mapping. Human-in-the-loop by design — see `data/captures/README.md` for why the pipeline never fetches the source and `docs/decisions/0003` for the labelling contract.

```sh
uv run python -m jaga_etl.lhkpn captures             # worklist a human follows (default limit: 10 regions)
uv run python -m jaga_etl.lhkpn register             # SHA-256 each saved page into data/captures/provenance.csv
uv run python -m jaga_etl.lhkpn build                # parse, join, gate, write ../../apps/web/src/data/lhkpn.json
uv run python -m jaga_etl.lhkpn report               # gate result only, no write
```

| Subcommand | Behavior                                                                                                                                                                                                                                                                                              |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| captures   | Reads `apps/web/src/data/officials.json` + `regions.json` and writes `data/captures/worklist.csv` plus `README.worklist.md`: region, official, the `Lembaga` to select, and the file to save. `--limit` defaults to 10 regions so the loop is proven before it scales to all 514 (`--limit 0` = all). |
| register   | Records `region_code`, `file`, and the SHA-256 of the exact bytes a human saved. A capture the worklist does not ask for is refused.                                                                                                                                                                  |
| build      | Parses every registered capture, keeps KPK's hidden per-row announcement id, reporting year, and report code, and publishes each region with all of its report years plus a `latest`.                                                                                                                 |
| report     | Writes `reports/lhkpn-<timestamp>.json` with the capture list and gate result; exits non-zero on errors.                                                                                                                                                                                              |

Gate (blocking, no output written): a registered capture missing from disk or whose bytes no longer hash to the recorded value; a capture with no provenance record or no worklist row; a page with no results table or no data rows; a `Lembaga` absent from `reference/lhkpn-institutions.csv` or mapped to a different region than the capture; rows naming more than one institution; a region claimed twice with conflicting figures; an amount that is not a positive rupiah figure; and a row missing any of the four labels ADR 0003 requires (reporting year, position at that year, source, processing date).

Extraction drops NIK and every other identifier beyond the public name, position, institution, year, and amount, and republishes only KPK's aggregated net total — never itemised assets or debts, and never the per-report detail views.

## Region reference import (`jaga_etl.regions`)

`extract → normalize → validate → load → report`

| Step      | Behavior                                                                                                                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| extract   | Downloads the pinned source once into `data/raw/` (gitignored), verifies SHA-256 and a size cap, writes `*.provenance.json`. Never overwrites an existing raw file.                                           |
| normalize | Parses `('code','name')` tuples from the SQL dump as text (never executed). Keeps `NN` provinces and `NN.NN` kabupaten/kota, trims whitespace, derives type from the `Kabupaten`/`Kota` prefix, builds slugs. |
| validate  | Blocks the load on duplicate codes/slugs, unknown prefixes, orphan regions, or any per-province kabupaten/kota count that differs from the official recap in `reference/`.                                    |
| load      | Upserts by official code with the `jaga_etl` role in one transaction. Codes missing from the source are deactivated (`is_active = false`), never deleted. Verifies the active count before commit.            |
| report    | Writes `reports/regions-<timestamp>.json` (gitignored) with source, checksum, row counts, gate result, and load summary.                                                                                      |

Source: Kepmendagri No. 300.2.2-2138 Tahun 2025 jo. No. 300.2.2-2430 Tahun 2025, via the MIT transcription [cahyadsn/wilayah](https://github.com/cahyadsn/wilayah) pinned to commit `d68e8d55`, cross-checked against the official recap counts (`reference/kepmendagri-300.2.2-2430-2025-recap.csv`).

## Budget + disaster publication (`jaga_etl.facts`)

`fetch (sealed snapshots) → normalize → map-region → quality gate → load-staging → verify → activate`

### Sources

| Data                                    | Source                                                                                                    | Access                                                                                                                   |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| APBD per kabupaten/kota                 | DJPK Kemenkeu, Portal Data SIKD (`djpk.kemenkeu.go.id/portal/data/apbd`), `periode=12` (year-end)         | One SpreadsheetML export per pemda (~510 per year), fetched politely. DJPK uses its own codes → name mapping below.      |
| Natural-resource revenue sharing        | DJPK Kemenkeu, Portal Data TKDD (`djpk.kemenkeu.go.id/portal/data/tkdd`), export `/portal/csv?type=tkdd`  | One SpreadsheetML export per pemda, fetched with the APBD file in the same DJPK snapshot (same pemda codes and mapping). |
| Disaster events and impact per province | BNPB Portal Satu Data Bencana, "Kompilasi Data Kejadian dan Dampak Bencana" 2024 (ODbL) and 2025 (ODC-BY) | CKAN `datastore_search` API (pinned resource IDs in `facts/bnpb/source.py`); the XLSX links sit behind a bot challenge.  |

Published budget figures are the **Belanja Daerah** row: anggaran (budget) and realisasi. DJPK's export does not say whether anggaran is the original or the revised APBD; the portal shows a single "Anggaran" column.

Expenditure-breakdown rows come from the same APBD export: the account lines printed between "Belanja Daerah" and "Pembiayaan Daerah". DJPK nests them as a flat list — the three direct children (Belanja Pegawai, Belanja Barang dan Jasa, Belanja Modal) followed by the "Belanja Lainnya" aggregate and its seven children (Belanja Bunga, Belanja Subsidi, Belanja Hibah, Belanja Bantuan Sosial, Belanja Bagi Hasil, Belanja Bantuan Keuangan, Belanja Tidak Terduga). Belanja Pegawai/Barang dan Jasa/Modal are each printed twice with identical figures and are collapsed to one row. Ten jenis are stored (`facts/djpk/normalize.py`); "Belanja Lainnya" is an aggregate of the last seven and is deliberately not stored, so the ten partition the Belanja Daerah total exactly. This is the classification by **jenis belanja**, not per-program or per-OPD spending.

Natural-resource rows come from the TKDD export: every "DBH SDA …" line plus "Dana Bagi Hasil Perkebunan Sawit", grouped into minyak_bumi, gas_bumi, minerba, kehutanan, perikanan, panas_bumi, perkebunan_sawit (`facts/djpk/tkdd.py`). Amounts are text in miliar rupiah with two decimals ("4.580,69 M"), converted exactly to rupiah; DJPK's rounding means Rp10 juta steps. These are transfers a region receives under the revenue-sharing formula, not a measure of its resources.

### Quality gate (blocking)

- Every DJPK pemda maps to a Kemendagri region: normalized-name match within the matched province, or a reviewed row in `reference/djpk-aliases.csv`. Unmatched names block publication.
- Every pemda with an APBD file must have a readable TKDD file; an unrecognised "DBH SDA …"/"Sawit" line, a duplicate resource line, or an amount not shaped "N.NNN,NN M" blocks publication. A blank amount makes that resource's total NULL, never a partial sum.
- No duplicate region-year rows; amounts non-negative; DJPK's reported percentage must agree with anggaran/realisasi (±0.01).
- The jenis-belanja subtotals must sum to the published Belanja Daerah total within the source's own rounding (Rp1.00). DJPK prints each figure rounded, so the eleven printed values can miss the total by up to half a unit each; across the sealed 2024/2025 snapshot the largest gap is Rp0.50. A larger gap — a missing or wrong jenis — blocks publication.
- Budget coverage ≥ 90% of autonomous kabupaten/kota per year (DKI Jakarta's administrative kab/kota have no APBD); missing regions are listed.
- BNPB: all reference provinces × 9 disaster types per year, and province sums equal BNPB's INDONESIA total per type and metric.
- Row counts within 10% of the active version, unless `--accept-row-delta` records a manual review.
- After staging, a database recount (rows, non-null counts, totals) must equal the computed values before activation.

Blank cells stay `NULL` ("Data belum tersedia"); reported zeros stay `0`. Values use `numeric(20,2)`; rows where DJPK printed 14-digit scientific notation are flagged as reduced precision.

### Publication

Each run creates a `dataset_versions` row (`staging`), two `data_sources` rows (snapshot manifest checksums), an `etl_runs` audit row, and the facts. Activation retires the previous active version and promotes the new one in a single transaction. Any failure marks the new version `failed`, keeps its report, and leaves the active version unchanged. Republishing identical snapshots is rejected (the version label includes both snapshot checksums).

## Expenditure breakdown for the static profile page (`jaga_etl.expenditure`)

Builds `apps/web/src/data/expenditure.json` so the profile page can render the jenis-belanja section as static HTML, without a running PostgreSQL and without calling the API.

```sh
bun run etl:expenditure                       # newest sealed DJPK snapshot on disk
uv run python -m jaga_etl.expenditure --snapshot data/raw/djpk/20261017T094824Z \
  --output ../../apps/web/src/data/expenditure.json
```

- Offline by construction: it reads the sealed APBD exports and the checked-in region reference (`data/raw/wilayah-*.sql`), never a database and never the network. `jaga_etl.facts publish` stays the database path; this is the static path, and both read the same parser and the same `facts.validate` reconciliation.
- Shape: `{ "source": {...}, "regions": { "<kemendagri code>": { "name": ..., "years": { "2025": <module> } } } }`. The inner module is field-for-field the API's `ExpenditureBreakdownModule` (`status`, `total_budget_amount`, `total_realization_amount`, `by_type[]`, `narrative[]`), so the static page and the API cannot disagree about the same bytes. Values are decimal strings; `NULL` means the source did not report a value, `0` means it reported zero.
- Status threshold, identical to the API: `unavailable` when there are no jenis rows, `partial` when any reported amount is blank, otherwise `complete`. A pemda that simply does not budget a jenis (many do not budget `belanja_bunga`) is still `complete`, because every figure the source did state is present.
- Gate (blocking): the same `EXPENDITURE_TOLERANCE` reconciliation as publication — jenis subtotals must sum to the published Belanja Daerah total within Rp1.00, so a missing or mis-parsed jenis fails the build instead of shipping a breakdown that does not add up. An unmatched pemda and DJPK's own percentage disagreement block too. Nothing is written when the gate fails.
- `source` carries publisher, title, URL, the ten labels, the rounding caveat, the murni/perubahan ambiguity the repo already documents, the snapshot id/created-at/checksum, and the processed-at timestamp.

## Belanja per fungsi, pendapatan, tutupan lahan, rumah sakit, sekolah

Static profile artifacts. Raw workbooks and HTML stay under `tools/etl/data/raw/` (gitignored). Derived JSON is what the site reads.

```sh
uv run python -m jaga_etl.fungsi build \
  --workbook data/raw/djpk-fungsi/31102025_Realisasi_Belanja_Daerah_2024.xlsx \
  --output ../../apps/web/src/data/expenditure-functions.json
uv run python -m jaga_etl.revenue build \
  --workbook data/raw/djpk-ringkas/31102025_Data_Realisasi_Ringkas_APBD_2024.xlsx \
  --output ../../apps/web/src/data/revenue.json
uv run python -m jaga_etl.land_cover build \
  --table data/raw/land-cover/pktl-2023.txt \
  --output ../../apps/web/src/data/land-cover.json
uv run python -m jaga_etl.places fetch --cache data/raw/places
uv run python -m jaga_etl.places build \
  --hospitals data/raw/places/sirs-rs.json \
  --schools data/raw/places \
  --output ../../apps/web/src/data/local-services.json
uv run python -m jaga_etl.opinions build \
  --csv data/raw/bpk-opini.csv \
  --output ../../apps/web/src/data/audit-opinions.json
uv run python -m jaga_etl.sanitation fetch --snapshot-root data/raw
uv run python -m jaga_etl.sanitation build \
  --page data/raw/sanitation/<id>/page.html \
  --output ../../apps/web/src/data/sanitation.json
```

- Fungsi: realization only. Kesehatan Tagging and Pendidikan Tagging fold into the parent function. Unmatched pemda names block the build. One missing pemda is left empty.
- Pendapatan: sum of the jenis lines under "4. Pendapatan Daerah" must match the sheet-1 pivot within Rp1. The amount column is named `nilaianggaran` inside a file the series page marks as realization. This is kas daerah, not household income.
- Tutupan lahan: 2023 PKTL rekap, province level, four classes (primer, sekunder, tanaman, bukan hutan). Mangrove, sawah, settlements, and species lists are not in that table. `statistik.menlhk.go.id` no longer resolves; the checksum is of the retrieved text.
- Rumah sakit: SIRS names, not the hospital code (that code is not Kemendagri). A name that matches more than one kabupaten/kota in the province is omitted, not assigned and not stored as zero.
- Sekolah: dikdas columns are SD then SMP; dikmen columns are SMA, SMK, then SLB. SLB is not published. The pages print no school year. "Luar Negeri" is skipped. `Adm.`, `Kep.`, and "Padang Sidempuan" are expanded to the reviewed official forms before the shared name key.
- Penduduk and rasio elektrifikasi are not built: there is no single national kabupaten/kota file with Kemendagri codes.
- Opini BPK: the Portal Data BPK CSV, one row per pemda, years 2016–2024. Codes `WTP`, `WDP`, `TW`, and `TMP` only. A blank year is omitted. An unknown code, a duplicate, a missing 2024 opinion, or a kabupaten/kota that is not in the Kemendagri list blocks the build. The six DKI administrative regions have no statement of their own; the page shows the Provinsi DKI Jakarta opinion and says so. The opinion is BPK's view of the financial statements, not a judgement of the official.
- Sanitasi layak: BPS statistics table 6.2.1* (variable 2748), the 2025 kabupaten/kota column, embedded in the public page and sealed under `data/raw/sanitation/`. The figure is the Susenas KOR share of households with their own or shared goose-neck toilet and a septic tank or sewer. It is not an ODF status and not safely managed sanitation. BPS codes are ignored; the printed name is matched to Kemendagri, with Mamuju Utara read as Pasangkayu (PP 61/2017). A blank cell is omitted, not stored as zero. An unmatched name or a Kemendagri region missing from the table blocks the build.

## Map outlines (`jaga_etl.boundaries`)

Builds `apps/web/public/data/map-regions.json` (pre-projected SVG paths for 514 kab/kota and 38 provinces, ~280 KB, ~94 KB gzip) so the web draws maps without a geo library or tile service.

- Source: [cahyadsn/wilayah_boundaries](https://github.com/cahyadsn/wilayah_boundaries), MIT, pinned to commit `28230eca6e787bac229db56825bd5b1843662c96`; codes follow Kepmendagri No. 300.2.2-2430/2025. SQL dumps are parsed as text, never executed.
- Snapshot: `data/raw/boundaries/<commit>/`, sealed and checksummed like the other sources (resumable).
- Gate: every Kemendagri kab/kota and province must have an outline and nothing extra may appear; otherwise the build fails.
- Processing: equirectangular projection scaled by cos(central latitude), Douglas–Peucker simplification at 0.6 px (width 1200), specks under 1.5 px² dropped, regions that vanish entirely kept as a 3 px marker.
- The output records the source repository, commit, and licence. Outlines are for display only, not for legal boundary use.

## Kecamatan maps (`jaga_etl.kecamatan_maps`)

Builds `apps/web/public/data/kecamatan/<regionCode>.json` (one file per kabupaten/kota, 514 files, 7,285 kecamatan; ~4.5 MB total, median ~7.6 KB, max ~77 KB) for the interactive map on the region profile.

```sh
bun run etl:kecamatan-maps                                   # fetch once (sealed), gate, write
uv run python -m jaga_etl.kecamatan_maps --output ../../apps/web/public/data/kecamatan   --snapshot data/raw/boundaries-kec/28230eca6e78              # offline
```

- Source: the same pinned [cahyadsn/wilayah_boundaries](https://github.com/cahyadsn/wilayah_boundaries) commit as the map outlines (MIT), files `db/kec/wilayah_boundaries_kec_<province>.sql` (38 files, ~12 MB). Parsed as text, never executed. Region outlines come from the `data/raw/boundaries/<commit>/` snapshot of `jaga_etl.boundaries`, which must exist first.
- Snapshot: `data/raw/boundaries-kec/<commit>/`, sealed and checksummed, resumable.
- Names are the Kemendagri kecamatan names from the pinned wilayah list (`data/raw/wilayah-*.sql`), joined strictly by code; the boundary file's own name column is ignored (it differs in spelling for 43 kecamatan).
- Shape: `{code, width: 600, height, projection: {west, north, scale, cos_lat}, outline, kecamatan: [{code, name, path, cx, cy}]}`, kecamatan sorted by name. Projection per region: `x = (lon - west) * scale * cos_lat`, `y = (north - lat) * scale`, so the browser can place other points with the same numbers. `cx`/`cy` is a label point inside the largest polygon of the drawn (simplified) shape.
- Processing: Douglas–Peucker at 0.6 px in each region's own 600 px frame, one-decimal coordinates; every island that keeps three points with a real area is kept. Outlines are simplified community data for display only, not legal boundaries.
- Gate (blocking, nothing written): for each region in `apps/web/src/data/regions.json`, every Kemendagri kecamatan has a boundary, every boundary code is in the Kemendagri list and inside a listed region, codes are unique, each region has an outline and at least one kecamatan, and every path and projection is non-empty and finite.
- Output goes through `jaga_etl.web_data.write_json` (indented) because Oxfmt checks `apps/web/public/data`.

## Regional heads in office (`jaga_etl.incumbents`)

Builds `apps/web/src/data/officials.json`: the bupati/wali kota and wakil currently in office for all 514 kabupaten/kota, cross-checked against the KPU Pilkada 2024 candidate list.

```sh
# Rebuild offline from the sealed snapshot (no network):
uv run python -m jaga_etl.incumbents \
  --candidates ../../apps/web/src/data/candidates.json \
  --output ../../apps/web/src/data/officials.json \
  --snapshot data/raw/wikipedia/20261017T102452Z
```

- Sources and licences: the 38 English Wikipedia pages "List of incumbent regional heads and deputy regional heads in ⟨province⟩" (CC BY-SA 4.0; each region cites the `oldid` revision URL it was read from) and Wikimedia Commons for photos, each carrying its own licence and author.
- Snapshot: `data/raw/wikipedia/<id>/`, one request for all 38 pages plus the Commons batches, sealed and checksummed like the other sources; `--resume <id>` continues an interrupted fetch.
- Wikimedia throttles anonymous tools: requests are spaced 10 s apart and `Retry-After` is honoured.
- Commons photos are attached only when a free licence is present; a file with no licence, or marked non-free, is dropped and the region keeps its initials placeholder. A reviewed name override clears the photo, because the row's image depicts the person it replaced.
- KPU cross-check semantics: each person is matched to a candidate pair in the same region by name similarity (≥ 0.8), preferring the candidate whose role matches the person's own office. The result is published as a fact — `kpu: null` renders as "Belum cocok dengan data KPU" (or "Diangkat, bukan lewat Pilkada" for DKI Jakarta's administrative kab/kota), never hidden or silently trusted.
- Alias files: `reference/wikipedia-aliases.csv` maps English region names to Kemendagri codes; `reference/kpu-aliases.csv` does the same for KPU's spellings.
- Reviewed overrides: `reference/incumbent-overrides.csv` replaces a value the Wikipedia row gets wrong (stale officeholder, disputed date), one row per field with the official source URL. The region's `page` still points at the Wikipedia revision the rest of the row came from.
- Gate: every one of the 514 regions must have a row, no two rows may map to the same region, and a computed `until` may never precede `since`; any violation fails the build.
- Output formatting: `jaga_etl.web_data.write_json` writes two-space indented, LF-terminated JSON with a final newline so `bun run format:check` stays green on the generated files.

## Natural conditions (`jaga_etl.nature`)

Builds `apps/web/src/data/nature.json`: the natural setting and recorded hazard exposure of each
kabupaten/kota. `fetch (sealed snapshot) → normalize → quality gate → write`.

```sh
uv run python -m jaga_etl.nature fetch                                        # network, sealed snapshot
uv run python -m jaga_etl.nature build --output ../../apps/web/src/data/nature.json
uv run python -m jaga_etl.nature build --output <path> --snapshot data/raw/nature/<id>   # offline
```

### Sources

| Figure                                                                                             | Source                                                                                            | Access                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Area per kabupaten/kota                                                                            | BIG (Badan Informasi Geospasial), `BATAS_KABKOTA_AR` MapServer layer 0 on `geoservices.big.go.id` | ArcGIS REST query, no key, `returnGeometry=false` returns the attribute table; `TIPADM` 4/5 selects kabupaten/kota, keyed by the Kemendagri code in `KDPKAB`. |
| Recorded disaster events per kabupaten/kota                                                        | BNPB Portal Satu Data Bencana, "Kompilasi Data Kejadian dan Dampak Bencana" (ODC-BY)              | CKAN `datastore_search` API (pinned resource IDs in `nature/source.py`); the XLSX links sit behind a bot challenge, as in `facts/bnpb`.                       |
| Recorded impact per kabupaten/kota (deaths, missing, injured, affected, displaced, houses damaged) | BNPB Portal Satu Data Bencana, 2024 compilation, per-kabupaten/kota tables (ODbL)                 | Same CKAN `datastore_search` API, one resource per metric, each holding the same nine hazard columns.                                                         |

The earthquake figure the page leads with is these same published BNPB tables: `gempabumi` is one
of the nine hazard columns of both the event table and every impact table, so recorded earthquakes
are published at kabupaten/kota level with their recorded human and housing impact. Because the
impact total for a metric is the sum of the nine hazard columns, a metric total is published only
when the source states all nine — otherwise the per-hazard figures are shown and the total is
withheld rather than becoming a partial sum.

Interpretation of "kondisi alam" for this module: objective, officially-published facts about a
region's natural setting and natural hazard exposure — not opinions, not predictions, not
narratives. Only figures the source itself states are published, and nothing is re-derived,
re-weighted, interpolated or scored.

### What is deliberately NOT a source: BNPB InaRISK / IRBI

BNPB's InaRISK portal publishes an official kabupaten/kota disaster-risk index (IRBI) and is
machine-readable (`/apiv4/data-irbi-full`, NDJSON, 514 regions × 2015–2025, no key). It is **not
used**, because InaRISK's own disclaimer forbids republication:

> "Seluruh konten, data, dan tampilan dalam InaRISK dilindungi oleh hak cipta. Dilarang mengutip,
> menyalin, atau menggunakan tanpa izin tertulis dari BNPB."

The IRBI publication PDF carries the same notice. Publishing those figures is therefore not
permitted; if BNPB grants written permission, the index can be added as a separate sub-topic with
its own definition, scale (0–300), class thresholds, publisher and source link. No risk score is
ever re-derived here, and an index is never presented as a probability or a prediction.

### Sub-topics with no official per-kabupaten/kota source

Dropped rather than substituted with a non-official source:

- **Elevation range / terrain.** BIG's per-region services carry only the statutory area:
  `BATAS_KABKOTA_AR` layer 0 offers `LUASWH` and boundary identifiers, and the 1:50K
  `Administrasi_AR_KabKota_50K` layer repeats the same field set. Elevation exists only as the
  national `DEMNAS` raster ImageServer (a figure would have to be computed here by zonal
  statistics) and as point spot-heights for a single area. `BASEMAP/Rupabumi_Indonesia` has an
  `ELEVASI` column, but it is null for every one of its 54,497 rows — these are toponym map labels,
  not terrain statistics. No publisher states a per-region elevation figure.
- **Coastline length.** BIG's `GARISPANTAI` services are polylines with no length field and no
  administrative codes (`GARISPANTAI_250K` covers only the Togean islands), so a per-region length
  would have to be derived.
- **Island count per kabupaten/kota.** Not in the pinned MIT transcription (its `wilayah` table has
  only codes and names), and no official national per-region table was found. BNPB's CKAN holds
  island counts for one city only (Kota Pariaman, by kecamatan).
- **Forest area and land cover by class.** Per-kabupaten/kota figures are still not published. The KLHK/Kemenhut geospatial hostnames no longer
  resolve at all (`sigi.*`, `webgis.*`, `geoportal.*`, `kawasanhutan.*`, `sipongi.menlhk.go.id` —
  DNS failures, consistent with the ministry split). The per-kabupaten/kota figures exist only
  inside the _Statistik Lingkungan Hidup_ PDF, whose cover states "Dilarang memperbanyak atau
  memperjualbelikan sebagian atau seluruh isi buku ini tanpa izin dari penerbit" — no reproduction
  without permission, so excluded. Province-level 2023 PKTL (four classes only) is a separate
  artifact: see "Belanja per fungsi, pendapatan, tutupan lahan, rumah sakit, sekolah" above. BIG's `PENUTUPLAHAN`/`VEGETASI` folders are RBI map sheets, not
  administrative units, and `Atlas_PenggunaanLahan` is a tiles-only service that cannot be queried
  for attributes.
- **Burnt area per kabupaten.** SiPongi (Kemenhut) does publish it as JSON, but its
  `/disclaimer-ft` limits use to "identifikasi dan pemantauan potensi kebakaran" and prohibits
  transfer — outside a civic transparency site's permitted purpose.
- **A per-kabupaten disaster-risk index.** Exists (BNPB InaRISK/IRBI) but its own terms forbid
  reuse, as the preceding section sets out.

### BMKG earthquake data: investigated and excluded on the publisher's terms

BMKG's feeds (`https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json`, `gempadirasakan.json`,
`gempaterkini.json`) return HTTP 200 JSON without a key, and the earthquake figures the module
publishes come from BNPB instead. BMKG is **not** used, for two independent reasons:

1. **Terms.** BMKG's Ketentuan Penggunaan (`https://www.bmkg.go.id/ketentuan-penggunaan`, last
   updated 8 July 2026) grants only "penggunaan pribadi dan nonkomersial", requires that
   "Pengaksesan layanan berupa data dan/atau informasi secara otomatis atau menggunakan metode
   machine-to-machine wajib melalui jalur Application Programming Interface (API) resmi", and
   states that "Pengemasan ulang, integrasi ke aplikasi pihak ketiga, atau penggunaan data untuk
   tujuan komersial wajib melalui izin tertulis resmi dari BMKG". Publishing BMKG-derived figures
   inside this application would be third-party integration requiring permission we do not hold,
   and no official public API endpoint was reachable (`data.bmkg.go.id/api/`,
   `api.bmkg.go.id/` → 404). The same terms prohibit scraping and prohibit removing or modifying
   the BMKG logo/watermark, which the site's own attribution rules depend on.
2. **Shape.** Those feeds are live rolling windows, not per-region records: at capture,
   `gempadirasakan` held 15 events spanning 12–17 October 2026 and `gempaterkini` six days, and each
   event's location is free text ("Pusat gempa berada di Laut 11 km TimurLaut Kota Sorong") rather
   than a Kemendagri code, so covering the 514 regions would need a name or spatial join invented
   here. The archival catalogue (`repogempa.bmkg.go.id/eventcatalog`) is form-token gated and does
   not answer a direct request. BMKG's own terms also note that the data cannot be presented as a
   warning or with cropped context, so an event feed would additionally have to avoid any
   present-tense danger framing — which the `tsunami_potential` text invites. Nothing is published,
   and no tsunami risk is inferred from any BMKG text.

### Coverage (published, never assumed complete)

Neither source covers all 514 regions, and an omitted region means the source does not state a
value — not that the value is zero. The gate reports the exact covered count per sub-topic into the
artifact's `source.coverage`, and the page prints it. As of 17 October 2026:

| Sub-topic                                  | Coverage |
| ------------------------------------------ | -------- |
| Area (BIG)                                 | 514/514  |
| Recorded events per year, 2010–2024 (BNPB) | 510/514  |
| Recorded events per hazard, 2024 (BNPB)    | 450/514  |
| Recorded impact per metric, 2024 (BNPB)    | 450/514  |

The four regions absent from the BNPB event series are 74.12 Konawe Kepulauan, 92.08 Kaimana,
95.06 Yalimo and 95.08 Nduga: they appear nowhere in the publication, not under another name. The
64 regions absent from the 2024 tables keep their published 2010–2024 series and show
"Data belum tersedia" for the 2024-only figures, never a zero.

### Gate (blocking) and reviewed tables

- Every source row must map to a region in the Kemendagri list; a row that cannot, or a region the
  list does not know, blocks publication.
- An area must be a positive number; an event count or impact figure may not be negative.
- A repeated region/year/hazard row, a repeated region/metric impact row, or a repeated
  region/hazard/metric impact row blocks publication rather than silently overwriting a value.
- BIG keeps older geodatabase editions beside the current one, so six region codes come back twice.
  The parse refuses to choose: each duplicate must be resolved by a reviewed row in
  `reference/nature-big-editions.csv` (code, edition, and a note recording the review).
- `LUASWH` is aliased "Luas Wilayah Menurut Peraturan (HA)" by BIG, but the published values are
  square kilometres: per-province sums reproduce the official provincial areas in km² (East Java
  48,055.87 vs 48,036; DI Yogyakarta 3,170.36 vs 3,170.6; Kota Bandung 166.59 vs 167.67). The
  artifact records the unit as km² and carries that note.

### Reuse basis

BNPB's event tables are ODC-BY (attribution). The impact tables are ODbL (share-alike), which is
why the derived database this module writes is offered under the same terms. BIG states no licence
or terms for its service — `copyrightText` is empty, the portal item's `licenseInfo` is null, and no
licence statement was found on `big.go.id` — so the area is published with `license: null`, the
caveat above, and the reuse decision recorded as an owner decision rather than an assumed grant.

### Presentation

`apps/web/src/components/profile/NatureConditions.astro` groups the figures so a reader can tell
"what this place is like" (Keadaan wilayah → area) from "what has happened here" (Riwayat bencana →
recorded earthquakes, all recorded events, recorded impact, the 2010–2024 series). Every figure
carries what it measures, its unit, its period and its publisher; the earthquake block and the
per-hazard tables state that the figures are historical records, not a prediction or a warning. An
absent value renders "Data belum tersedia" and a published 0 renders 0, and the coverage of each
sub-topic is printed next to it.

## Weather/climate context (`jaga_etl.weather`)

Builds `apps/web/src/data/weather.json`: BMKG's monthly **normal** (long-term average) rainfall for 1981–2010 for every kabupaten/kota, read at one reviewed sample point inside each region.

```sh
# Fetch a new sealed snapshot (network, ~514 polite requests), then publish from it:
uv run python -m jaga_etl.weather
uv run python -m jaga_etl.weather --snapshot data/raw/bmkg-weather/<id> --output ../../apps/web/src/data/weather.json

# Rebuild offline from the sealed snapshot (no network):
uv run python -m jaga_etl.weather --snapshot data/raw/bmkg-weather/<id> --output ../../apps/web/src/data/weather.json

# Regenerate the reviewed sample-point file after a boundary change (review the diff):
uv run python -m jaga_etl.weather --propose-points
```

**Why static climatology, not a forecast.** PRD §5 excludes real-time data and PRD §9 requires the demo to work without upstream availability. BMKG's open forecast feed (`api.bmkg.go.id/publik/prakiraan-cuaca?adm4=…`) is a 3-day forecast refreshed twice daily, so the profile must not depend on it. The normal-rainfall product is a finished climatology: it does not change between runs, and the published figure is reproducible from the sealed snapshot with no network.

| Item               | Finding (checked 17 October 2026)                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product            | BMKG "Peta Normal Curah Hujan", monthly normal rainfall, period **1981–2010**                                                                                                                                                                                                                                                                                                                                                                                                 |
| Service            | `gis.bmkg.go.id/arcgis/rest/services/Normal_hujan_30th/Normal_curah_hujan/MapServer` on BMKG's "Satu Peta MKG" portal                                                                                                                                                                                                                                                                                                                                                         |
| Access             | ArcGIS REST `identify` (declared API, not HTML scraping), one point per request, no key, no CAPTCHA, HTTP 200, JSON                                                                                                                                                                                                                                                                                                                                                           |
| Format / level     | Raster, 12 monthly layers (ids 0–11 = January–December); a value per sampled coordinate, **not** a per-region table                                                                                                                                                                                                                                                                                                                                                           |
| Publication period | BMKG's own service metadata: `data blanding cmss dengan gsmap 1981 - 2010`                                                                                                                                                                                                                                                                                                                                                                                                    |
| Reuse terms        | BMKG Ketentuan Penggunaan (`bmkg.go.id/ketentuan-penggunaan`): attribution "Sumber: BMKG" and the BMKG logo are mandatory; **repackaging or integrating into a third-party application requires BMKG's written permission**, which is not held; automated machine-to-machine access must use an official BMKG API. Perka BMKG No. 4 Tahun 2022 classifies processed climate data as Data Level 2 (dikelola/diakses melalui layanan daring, permintaan data, atau kerja sama). |
| Residual risk      | **Owner decision, unresolved** — the same shape as the LHKPN reuse basis in `docs/decisions/0003-publish-lhkpn-figures.md`. Until BMKG grants integration permission, the figure is published with full attribution and an unchanged meaning, and the section states that status.                                                                                                                                                                                             |
| Not provided       | Current weather, forecasts, early warnings, temperature, wind, or per-kecamatan values. BMKG publishes per-region **earthquake** data (see `data.bmkg.go.id/gempabumi`), which belongs to the nature module, not this one.                                                                                                                                                                                                                                                    |

**One figure per region.** The source is queried by coordinate, so the value is read at one point per kabupaten/kota, taken from `reference/weather-sample-points.csv` (reviewed data: one row per Kemendagri code with the point and the method that produced it). A point sample **approximates** a whole region — a kabupaten spanning coastal plain and mountain has one value for both — and the UI says so. The published record carries the point, so the claim stays checkable.

- Gate (blocking): every one of the 514 Kemendagri kabupaten/kota must have exactly one reviewed sample point, that point must fall **inside its own boundary** (re-checked against the sealed boundary snapshot), no two regions may share a point, the snapshot must have been fetched at that exact URL, and all twelve months must be present. A region whose cell falls outside BMKG's coverage is published as unavailable with the reason, never as `0`.
- Known source artefacts, 17 October 2026 snapshot: two Sumbawa cells report a physically impossible **negative** normal — 52.04 Kabupaten Sumbawa for Agustus and 52.05 Kabupaten Dompu for Agustus and September — and two regions (11.72 Kota Sabang, 96.01 Kabupaten Sorong) fall outside the raster entirely (`NoData` for all twelve months). None is published as a figure: those four regions show "Data belum tersedia" with the reason, so the run covers **510 of 514** kabupaten/kota. Negative months are never published and no partial total is ever summed.
- Politeness: one request at a time, spaced 0.3 s, identifying User-Agent, response-size cap, and `Retry-After` honoured by the shared `PoliteFetcher`; a `NoData` cell is retried on at most 5 interior candidates so a poorly covered region cannot multiply requests. The snapshot under `data/raw/bmkg-weather/<id>/` is sealed, SHA-256-checksummed and resumable.

## Live-conditions reference points (`jaga_etl.live_points`)

Builds `apps/api/src/data/live-points.json`, the static per-region lookup the Worker uses to query live sources by location. Offline only: it reads files already on disk and never downloads.

```sh
uv run python -m jaga_etl.live_points --output ../../apps/api/src/data/live-points.json  # from tools/etl
# overrides: --wilayah <sql> --boundaries <snapshot dir> --points <csv> --regions <regions.json>
```

- Inputs, all joined by Kemendagri code (never by name): the pinned wilayah dump (SHA-256 checked against `regions/source.py`), `reference/weather-sample-points.csv`, the sealed boundary snapshot, and `apps/web/src/data/regions.json` (authoritative slugs; its names must equal wilayah's).
- `adm4`: the lowest-coded kelurahan/desa inside the lowest-coded kecamatan of the region. It is only the point a forecast is read for and is labelled by its desa/kecamatan name; it is not the regency capital.
- `lat`/`lon`: the reviewed sample point, 4 decimals. `bbox`: `[west, south, east, north]` over every boundary ring, rounded outward to 3 decimals; a box filter, not a point-in-region test.
- `kecamatan_list`: every kecamatan of the region (`code`, `name` as written in wilayah, `adm4`, `desa`), sorted by name, so a reader can pick the forecast point; each `adm4` is the lowest-coded kelurahan/desa in that kecamatan. The top-level `adm4`/`desa`/`kecamatan` are the default and equal the entry for the lowest-coded kecamatan.
- Gate (blocking, nothing written on failure): exactly 514 regions matching `regions.json`; every region present in wilayah, the sample points and the boundaries; no duplicate codes in wilayah; an adm4 of shape `NN.NN.NN.NNNN` under the region code; at least one kecamatan, and every kecamatan has a kelurahan/desa whose adm4 sits under its own code; kecamatan codes unique; the default kecamatan listed exactly once with the same adm4 as the top-level one; a non-degenerate bbox inside lon 94–142 / lat −12–7 that contains the whole outline and the sample point.
