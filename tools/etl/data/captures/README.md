# LHKPN captures (gitignored)

This directory holds the **exact files a human saved** from KPK's e-LHKPN search. Nothing else may
live here, and nothing here is committed: it is in `.gitignore` because a results page carries real
figures and third-party personal data, and the published artifact is only
`apps/web/src/data/lhkpn.json`.

## Why the pipeline never fetches the page

The e-Announcement search (`POST https://elhkpn.kpk.go.id/portal/user/check_search_announ`) is
gated by reCAPTCHA v3 and offers no public API. This repository's rules (`AGENTS.md` "Data and ETL
Integrity", `docs/decisions/0003`, `docs/SECURITY.md` "Personal Data (LHKPN)") forbid bypassing a
CAPTCHA, bot challenge, WAF, or login, so **a human performs every search in a real browser** and the
pipeline only reads what that human saved. No command under `jaga_etl.lhkpn` opens a network
connection; `captures`, `register`, `build` and `report` all run offline.

Three third-party projects that touch the same site converge on the approach this repository
rejects, which is the evidence that the manual route is the only compliant one:

- `nichsedge/lhkpn` drives the form with Playwright plus `playwright-stealth` ("Uses
  playwright-stealth to reduce detection") — automated evasion of the bot gate — and additionally
  scrapes the per-report modal views into itemised asset arrays (`tanah_bangunan`, `hutang`, …),
  which is exactly the third-party detail ADR 0003 forbids republishing.
- `suryast/indonesia-gov-apis` reviewed that project read-only and wrote the same conclusion in
  `apis/tier2-scrapeable/kpk-lhkpn/README.md`: "No public JSON API contract was verified. A landing
  page returning HTTP 200 is not API success." and "Do not bypass CAPTCHA, use stealth/proxies to
  evade restrictions, harvest personal identifiers, or treat third-party scraped data as an official
  KPK response."
- `suryast/indonesia-civic-stack` ships an `lhkpn` module installed with "Playwright and Camoufox"
  browser extras and a `PROXY_URL` layer; Camoufox is an anti-detection browser and proxy routing is
  another evasion vector. Its own README hedges: "LHKPN's browser search implementation does not
  prove that reCAPTCHA or the upstream portal works in your deployment."

Stealth browsers (Camoufox, `playwright-stealth`) and proxy routing are therefore **out of bounds
for this repository**, as is reading the itemised detail view. Aggregated published totals only.

## What to save

1. Run `uv run python -m jaga_etl.lhkpn captures` (from `tools/etl`) and open
   `README.worklist.md` in this directory. Each row names one region, the official's name to type,
   the `Lembaga` to pick in the dropdown, and the file name to save.
2. In a browser, open <https://elhkpn.kpk.go.id/>, go to **e-Announcement**, enter the **Nama**, and
   select the **Lembaga** from the dropdown. Filtering by institution is what makes the figure belong
   to exactly one region — do not search by name alone.
3. **Solve the CAPTCHA yourself.** Never automate this step.
4. Save the resulting page as `data/captures/<region_code>.html` (`Ctrl+S`, "Webpage, HTML only").
   A `.json` file holding the raw response body is also accepted if it contains the same rendered
   table.

Only rows from the region's own `PEMERINTAH KABUPATEN/KOTA …` institution are publishable. A row
filed under KPUD, DPRD, or a party is from a different office (the person's earlier career) and will
stop the build rather than be published with the wrong position — re-run the search with the
institution filter set.

## Worked example (not stored here)

On 17 October 2026 the owner ran this exact loop for **32.01 Kabupaten Bogor**, searching
`Rudy Susmanto` and filtering on `PEMERINTAH KABUPATEN BOGOR`. The page returned seven rows for that
name across three institutions:

| Year | Jabatan            | Lembaga                                        | Jenis Laporan         | Total Harta Kekayaan |
| ---- | ------------------ | ---------------------------------------------- | --------------------- | -------------------- |
| 2025 | BUPATI             | PEMERINTAH KABUPATEN BOGOR                     | Periodik              | Rp.12.641.245.449    |
| 2024 | CALON BUPATI       | KPUD (CALON KEPALA DAERAH)                     | Khusus, Awal Menjabat | Rp.9.356.404.065     |
| 2023 | KETUA DPRD         | DEWAN PERWAKILAN RAKYAT DAERAH KABUPATEN BOGOR | Periodik              | Rp.8.050.087.610     |
| 2022 | KETUA DPRD         | DEWAN PERWAKILAN RAKYAT DAERAH KABUPATEN BOGOR | Periodik              | Rp.6.858.087.610     |
| 2021 | KETUA DPRD         | DEWAN PERWAKILAN RAKYAT DAERAH KABUPATEN BOGOR | Periodik              | Rp.6.130.621.760     |
| 2020 | KETUA DPRD         | DEWAN PERWAKILAN RAKYAT DAERAH KABUPATEN BOGOR | Periodik              | Rp.4.482.008.102     |
| 2019 | CALON ANGGOTA DPRD | KPU (CALON ANGGOTA DPRD)                       | Khusus, Calon PN      | Rp.3.077.266.000     |

The case is recorded here rather than as a file in this directory because the owner's evidence was a
DevTools view of the request and the rendered table, not a saved page. Reconstructing an HTML file to
stand in for a capture would fabricate a raw artifact and break the provenance rule this repository
requires — every published figure must be reproducible from the exact bytes a human captured — so
`lhkpn.json` starts with **zero regions** and every region renders an honest "belum tersedia" state
until a real capture is saved. The data also shows why the region must be joined through `Lembaga`
and not through a name, and why "latest" must not be the newest row blindly: only the 2025 row is the
office held now, and the other six belong to `KPUD`/`DPRD`, which are not regional governments.

## Provenance

`register` writes `provenance.csv` here with one row per capture: `region_code`, `file`, the
`sha256` of the exact bytes saved, and when it was registered. `build` refuses to publish a capture
whose bytes no longer hash to the recorded value, a capture that no worklist row asks for, or a
capture registered for a region the worklist does not name. The registry is not committed either —
it points at files that are not.

## Going live for one region

```sh
cd tools/etl
uv run python -m jaga_etl.lhkpn captures            # writes worklist.csv + README.worklist.md
# ... save the browser results page as data/captures/32.01.html ...
uv run python -m jaga_etl.lhkpn register            # hashes it into provenance.csv
uv run python -m jaga_etl.lhkpn build               # writes ../../apps/web/src/data/lhkpn.json
cd ../.. && bun run build                            # renders the section on the region profile
```
