# Contributing to JagaDaerah

## Sebelum Memulai

1. Baca `PRD.md`, `AGENTS.md`, dan standar relevan di `docs/`.
2. Pastikan perubahan berada dalam scope First Draft atau memiliki persetujuan eksplisit.
3. Untuk perubahan besar, tulis masalah, perilaku yang diinginkan, alternatif, dan risiko sebelum coding.

## Branch dan Commit

- Gunakan branch pendek berbasis tujuan, misalnya `feat/region-search` atau `fix/budget-zero-state`.
- Satu commit sebaiknya mewakili satu perubahan logis.
- Jangan mencampur refactor tidak terkait dengan fitur atau bug fix.
- Gunakan pesan commit berbentuk imperatif dan jelas.

Contoh:

```text
feat(web): add accessible region autocomplete
fix(api): preserve null disaster counts
docs: clarify dataset publication flow
```

## Quality Gate

Sebelum pull request:

```sh
bun install --frozen-lockfile
bun run check
bun run build
```

Jalankan test integrasi atau E2E yang relevan jika perubahan menyentuh Worker, PostgreSQL, kontrak API, atau alur pengguna.

## Isi Pull Request

- Masalah dan outcome yang diinginkan.
- Ringkasan perubahan.
- Cara verifikasi dan hasilnya.
- Screenshot/video untuk perubahan visual pada mobile dan desktop.
- Dampak schema, kontrak, environment, keamanan, data, dan rollback.
- Risiko tersisa yang benar-benar relevan.

## Review Checklist

- Scope kecil dan sesuai PRD.
- Tidak ada dependency atau abstraksi tanpa kebutuhan.
- Format, lint, typecheck, test, dan build lulus.
- UI memiliki state loading/empty/error/partial yang sesuai.
- Keyboard, fokus, kontras, dan responsive layout diperiksa.
- Query terparameterisasi dan input tervalidasi.
- Tidak ada secret, data production, atau detail internal di response/log.
- Dokumentasi ikut diperbarui bila kontrak atau operasi berubah.
- Dependency direction dan public package boundaries tetap terjaga.
- Tidak ada business logic di route, component presentation, atau repository.

## Perubahan Database

- Ubah Drizzle schema di `apps/api/src/db/`, lalu hasilkan migration dengan script Bun yang membungkus `drizzle-kit generate`.
- Review SQL dan metadata yang dihasilkan sebelum commit.
- Tambahkan migration baru; jangan edit migration Drizzle yang sudah diterapkan.
- Jalankan `drizzle-kit check` melalui script repository.
- `drizzle-kit push` hanya boleh dipakai untuk database lokal disposable dan dilarang untuk staging/production.
- Gunakan rollout backward-compatible.
- Sertakan verification query dan rollback/roll-forward plan.
- Uji migration pada PostgreSQL staging/test sebelum production.

## Pelaporan Kerentanan

Jangan membuka detail kerentanan aktif di issue publik. Gunakan kanal privat pemilik repository setelah kanal tersebut ditentukan.
