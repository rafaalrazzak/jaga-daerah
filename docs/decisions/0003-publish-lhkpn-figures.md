# 0003 — Publish LHKPN figures instead of link-out only

## Status

Accepted — 17 October 2026, by repository owner decision, replacing the earlier link-out-only scope. Safeguards below are settled; one related question is still the owner's to close (see Context, "Open question").

## Context

`PRD.md` §5 originally scoped the "Harta kekayaan pejabat daerah" section as a link-out: JagaDaerah would not copy, store, or display LHKPN figures, on the grounds that the KPK search is a reCAPTCHA form with no public API and that personal data falls under UU PDP No. 27 Tahun 2022.

The owner asked to obtain LHKPN data for the regional officials of each kabupaten/kota and show it on region profiles. This ADR fixes the written contract before the ETL and API work exists, so that the pipeline is built against a reviewed rule instead of an informal one.

Grounding for the labelling rules: Peraturan KPK No. 7 Tahun 2016 (as amended by Peraturan KPK No. 2 Tahun 2020 and Peraturan KPK No. 3 Tahun 2024) governs the registration, announcement, and examination of LHKPN. A serving official reports periodically once a year, covering wealth acquired from 1 January to 31 December, submitted by 31 March of the following year. LHKPN is therefore an annual statement with a defined reporting year, not a live balance.

### Open question (owner decision)

Evidence gathered on 17 October 2026: the public e-LHKPN privacy notice (`https://privpol.kpk.go.id/elhkpn`) states that once a report passes the announcement stage KPK displays the official's identity — name, instansi, jabatan, total harta, and reporting period — with the announcement sheet as the published document; it is a UU PDP No. 27 Tahun 2022 privacy notice, it grants no reuse or redistribution right, and the site footer reserves all rights. The e-Announcement access path is also gated to institutional account holders. Reading this against UU No. 28 Tahun 1999 and Peraturan KPK 7/2016, which mandate the periodic filing and public announcement of LHKPN, is a legal question this repository cannot settle, and a definitive answer would need KPK itself.

The owner has already decided to publish figures. Two ways to close the reuse question remain, and both keep every safeguard in Decision unchanged:

- **(a) Wait for a written reuse determination from KPK** recorded with the source provenance before the first figure ships. Lowest legal exposure; depends on KPK's response and may not arrive within the competition timeline.
- **(b) Publish on the basis that LHKPN announcement is a legally mandated public disclosure**, with KPK named as publisher, a link to the official publication, and the neutral-presentation rules applied, accepting the residual reuse risk that no explicit redistribution grant exists.

This document records (b) as the working assumption unless the owner states otherwise, because the owner has instructed that figures be shown; that assumption is a risk accepted by the owner, not a legal conclusion. If the owner chooses (a), only the first-figure date changes — nothing else in this ADR does.

## Decision

- Region profiles publish declared wealth figures obtained from LHKPN publications, and only where an official KPK source document or URL exists for that person and that reporting year. The reuse basis under which they ship is the owner's decision recorded in Context ("Open question").
- Every published figure carries four labels together, from the same record: the reporting year, the position held in that reporting year, the official source document or URL, and the download/processing date. No figure is presented as current wealth. A figure missing any of the four labels is not published.
- Every published figure is also attached to the region through a reviewed mapping artifact, never through a silent name join (see below).
- Presentation is neutral. Figures are not an audit result, are never used to imply wrongdoing or causation, and are never presented as a single-number performance claim, consistent with `AGENTS.md` and `PRD.md` §7.5.
- Declared assets and declared debt are stored and displayed together. If a source record supports only one of them, the UI states that limitation instead of showing assets alone; the section never renders a net figure that the source does not state.
- Currency follows the existing rule: `numeric(20,2)` with Drizzle `mode: 'string'`, kept as decimal strings across the database boundary, never coerced to a lossy JavaScript `number`.
- Acquisition never bypasses a CAPTCHA, bot challenge, WAF, or login. There is no fabricated, interpolated, or estimated figure; a figure with no official source is not published.
- Name-to-region attachment follows the audit-report rule already applied to other region mappings: fallback or manual matches live in a reviewed CSV under `tools/etl/reference/` with a README recording source and review date. An unresolved or contradictory match blocks publication of that record rather than guessing.
- Attribution and reuse. KPK is named as the publisher, the figure links to the official KPK publication, and the UI states that JagaDaerah is not the publisher and that the figures are not an audit result. Reuse is asserted on the owner's decision in Context, not on a licence: no reuse or redistribution grant was found in KPK's public materials, and a reserved-rights footer was found, so the section carries the residual reuse risk that a republishing basis is asserted without written confirmation. If KPK states terms that forbid republication, publishing stops and the section reverts to link-out.

## Alternatives considered

- Keep link-out only: the previous scope. Rejected by the owner.
- Automate the KPK search form: no public API is offered and the form is protected by a bot challenge; scraping it would breach the no-bypass rule. Rejected.
- Publish assets without debt: rejected as misleading, because LHKPN declares both, and the omission would imply absent liabilities.
- Defer publishing until KPK grants reuse in writing: coherent option, left to the owner (Context option a). It trades timeline for the lowest legal exposure; it is not rejected, only not the default.
- Publish on the basis that LHKPN announcement is a legally mandated public disclosure: the working assumption unless the owner says otherwise (Context option b). Public visibility of an announcement is not itself a redistribution licence, so this asserts a basis rather than proving one and leaves a residual reuse risk with the owner.
- Interpolate or estimate missing reporting years: rejected; an estimated figure has no official source.
- Join officials to regions by name silently: rejected by the existing data-integrity rule that region matches by name require an audit report.
- Present the newest available figure as current wealth: rejected; LHKPN is annual and a previous reporting year must be shown as such.

## Consequences

- The reuse question is an accepted risk rather than a settled right: figures ship on the owner's decision while no written KPK reuse grant exists, and the section must be able to revert to link-out if KPK states terms that forbid republication.
- The region profile gains a new data-required state: unavailable, partial (assets or debt only), and complete. Empty and partial must be handled explicitly, and the section must not break page rendering when absent.
- Provenance is mandatory, so each stored record needs source identity, reporting year, position at that year, and processing date; a record without them is a rejected row, not a nullable display.
- The reviewed mapping artifact becomes a publication gate, so a bare name is never sufficient input.
- Attribution and neutral-copy rules add UI copy and review effort for every figure.
- Publishing personal data beyond the public name and position would fall outside this decision and requires a separate owner decision.

## Migration

No pipeline exists yet. Implementations must be built from this decision rather than retrofitted. The earlier link-out framing is superseded where it appears in `PRD.md`; `PROJECT_STATUS.md` and the profile component are owned by other sessions and must be updated by their owners to match.

## Rollback

Revert to link-out only: stop publishing figures, remove the stored figures and their mapping artifact, and restore the explanation-plus-outbound-link section described in the superseded scope. Source snapshots and provenance stay with the raw inputs, so no upstream data is lost.
