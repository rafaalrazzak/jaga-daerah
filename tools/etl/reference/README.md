# ETL Reference Tables

## `kepmendagri-300.2.2-2430-2025-recap.csv`

Per-province kabupaten and kota counts transcribed from Lampiran A, "Rekapitulasi Kode, Data Wilayah Administrasi Pemerintahan, dan Pulau Per Provinsi Seluruh Indonesia", of Kepmendagri No. 300.2.2-2430 Tahun 2025 (ditetapkan 23 Juni 2025).

- Official PDF: <https://ditjenbinaadwil.kemendagri.go.id/download/file/Kepmen_Perubahan_300.2.2-2430.pdf>
- Totals: 38 provinces, 416 kabupaten, 98 kota (514 kabupaten/kota).
- Transcribed and checked on 17 October 2026; column sums match the official totals.

The region import refuses to load when the upstream code list disagrees with these counts. Update this file only from a newer official Kepmendagri, and update the pinned source in `src/jaga_etl/regions/source.py` in the same change.

## `wikipedia-aliases.csv`, `kpu-aliases.csv`

Reviewed name → region-code mappings for spellings the automatic match cannot resolve: English Wikipedia region names (`wikipedia_name`) and KPU region names (`kpu_name`), each against the Kemendagri code, with a `note` giving the reason. Read by `jaga_etl.incumbents` and `jaga_etl.officials` respectively.

## `lhkpn-institutions.csv`

Reviewed `Lembaga` → Kemendagri region mapping for `jaga_etl.lhkpn`: KPK's institution name as it appears in the e-Announcement results table (`PEMERINTAH KABUPATEN BOGOR`) against the Kemendagri code, with a `note` recording how it was confirmed in the e-Announcement `Lembaga` dropdown.

This file replaces a name join deliberately. A person's results page lists rows from other institutions and other offices — the worked example in `data/captures/README.md` shows one bupati's seven rows split across `PEMERINTAH KABUPATEN BOGOR`, `KPUD`, `DPRD`, and a party — so a figure is attached to a region only through a reviewed institution row. `jaga_etl.lhkpn build` blocks when a captured `Lembaga` is absent here, or when it maps to a different region than the capture's own.

## `incumbent-overrides.csv`

Reviewed corrections for `jaga_etl.incumbents`, one row per replaced field: `field` is one of `head_name`, `head_party`, `deputy_name`, `deputy_party`, `since`, `until`. Use it only when the Wikipedia row is stale or contradicts the official page, and always record the official `source_url` and a `note`. An override wins over Wikipedia; the region's `page` still cites the Wikipedia revision the rest of the row came from, and overriding a `name` clears that person's photo.

Every applied row is carried into the published `apps/web/src/data/officials.json` as a `corrections` entry on that region (`field`, `source_url`, `note`, verbatim from the CSV), and the region profile renders the corrected field names against the linked official source in its footer — so a value taken from a government page is never attributed to the Wikipedia revision. A row missing its `source_url` or `note` fails the build, and a region with no override row has an empty `corrections` list.

Rows added 17 October 2026: `31.74` head/deputy and `31.73` deputy (English Wikipedia frozen at revid 1364052047, 14 July 2026: Jakarta Selatan's wali kota is now Syafrin Liputo — sworn 15 April 2026, `selatan.jakarta.go.id` — and its deputy Firmanudin Ibrahim, with Ali Murtadho moving to Jakarta Barat on 1 August 2026, `barat.jakarta.go.id`), and `35.02` `since` 10 November 2025 (official profile `ponorogo.go.id`; the Wikipedia row says 8 November 2025).
