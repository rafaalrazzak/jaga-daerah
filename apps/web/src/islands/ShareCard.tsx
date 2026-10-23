import type { RegionSummary } from '@jaga-daerah/contracts';
import { useState } from 'react';

import { AUDIT_OPINIONS } from '@/lib/audit-opinions';
import { LOCAL_SERVICES } from '@/lib/local-services';
import { NATURE } from '@/lib/nature';
import { OFFICIALS } from '@/lib/officials';
import { formatCount } from '@/lib/format';

interface ShareCardProps {
  region: RegionSummary;
}

function handlePrint() {
  if (typeof window !== 'undefined') {
    window.print();
  }
}

export default function ShareCard({ region }: ShareCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const head = OFFICIALS.regions[region.code]?.head ?? null;
  const services = LOCAL_SERVICES.regions[region.code];
  const hospitals = services?.hospitals;
  const schools = services?.schools;
  const population = services?.population;
  const totalSchools = schools ? schools.sd + schools.smp + schools.sma + schools.smk : null;

  const natureEntry = NATURE.regions[region.code];
  const disaster2024 = natureEntry?.events_by_year?.['2024'] ?? null;
  const latestOpinion = AUDIT_OPINIONS.regions[region.code]?.years?.at(-1);

  const currentUrl =
    typeof window !== 'undefined'
      ? window.location.href
      : `https://jagadaerah.id/daerah/${region.slug}`;

  const shareText = `📊 Data Transparansi Resmi: ${region.name} (${region.province.name})
👤 Pimpinan: ${head ? head.name : 'Data belum tersedia'}
👥 Penduduk: ${population ? `${formatCount(population.total)} jiwa` : '-'}
🏥 Fasilitas Kesehatan: ${hospitals?.total ?? '-'} RS
🏫 Sekolah: ${totalSchools ? formatCount(totalSchools) : '-'} (SD/SMP/SMA/SMK)
📋 Opini BPK RI: ${latestOpinion?.opinion ?? 'Dalam evaluasi'} (${latestOpinion?.year ?? '2024'})
⚠️ Kejadian Bencana 2024: ${disaster2024 !== null ? `${disaster2024} kali (BNPB)` : '-'}
🔗 Cek rincian APBD & anggaran lengkap di: ${currentUrl}`;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  }

  function handleWhatsApp() {
    const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}`;
    window.open(waUrl, '_blank', 'noopener,noreferrer');
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-background px-4 text-sm font-semibold text-foreground hover:bg-secondary focus-visible:outline-3 focus-visible:outline-ring"
        title="Bagikan ringkasan data daerah"
      >
        <svg
          viewBox="0 0 20 20"
          className="size-4 text-muted-foreground"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M13 4.5a2.5 2.5 0 11.702 1.737L6.97 9.604a2.518 2.518 0 010 .792l6.733 3.367a2.5 2.5 0 11-.671 1.341l-6.733-3.367a2.5 2.5 0 110-3.474l6.733-3.367A2.52 2.52 0 0113 4.5z" />
        </svg>
        <span>Bagikan Data</span>
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Kartu Ringkasan ${region.name}`}
          className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
        >
          <div className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-border bg-card p-6 shadow-2xl animate-rise">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="text-base font-extrabold text-foreground">
                  Ringkasan & Dokumen Daerah
                </h3>
                <p className="text-xs text-muted-foreground">
                  Data resmi terverifikasi untuk publik & wartawan
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="Tutup dialog"
                className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <svg
                  viewBox="0 0 20 20"
                  className="size-4.5"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>

            {/* Stylized Infographic Card Preview with REAL DATA */}
            <div className="my-4 rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-background to-secondary p-5 text-card-foreground shadow-inner">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold tracking-wider text-primary uppercase">
                  JagaDaerah · Transparansi Publik
                </span>
                <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-bold text-primary">
                  Data Terverifikasi
                </span>
              </div>

              <h4 className="mt-2 text-xl font-black tracking-tight text-foreground">
                {region.name}
              </h4>
              <p className="text-xs text-muted-foreground">
                Provinsi {region.province.name} · Kemendagri {region.code}
              </p>

              {/* Data Grid with real numbers */}
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-xl bg-background/80 p-2.5 shadow-2xs">
                  <span className="text-[11px] text-muted-foreground">Pimpinan Daerah</span>
                  <p className="font-bold text-foreground truncate">
                    {head ? head.name : 'Data belum tersedia'}
                  </p>
                </div>
                <div className="rounded-xl bg-background/80 p-2.5 shadow-2xs">
                  <span className="text-[11px] text-muted-foreground">Jumlah Penduduk</span>
                  <p className="font-bold text-foreground">
                    {population ? `${formatCount(population.total)} jiwa` : 'Data dihimpun'}
                  </p>
                </div>
                <div className="rounded-xl bg-background/80 p-2.5 shadow-2xs">
                  <span className="text-[11px] text-muted-foreground">Rumah Sakit & Sekolah</span>
                  <p className="font-bold text-foreground">
                    {hospitals?.total ?? 0} RS · {totalSchools ? formatCount(totalSchools) : 0}{' '}
                    Sekolah
                  </p>
                </div>
                <div className="rounded-xl bg-background/80 p-2.5 shadow-2xs">
                  <span className="text-[11px] text-muted-foreground">Opini BPK RI</span>
                  <p className="font-bold text-foreground">
                    {latestOpinion
                      ? `${latestOpinion.opinion} (${latestOpinion.year})`
                      : 'Dalam evaluasi'}
                  </p>
                </div>
                <div className="col-span-2 rounded-xl bg-background/80 p-2.5 shadow-2xs">
                  <span className="text-[11px] text-muted-foreground">
                    Kejadian Bencana 2024 (BNPB)
                  </span>
                  <p className="font-bold text-foreground">
                    {disaster2024 !== null
                      ? `${disaster2024} kali kejadian resmi tercatat`
                      : 'Data dihimpun'}
                  </p>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between text-[10px] text-muted-foreground">
                <span>jagadaerah.id</span>
                <span>Sumber: DJPK, BPK RI, BNPB, Kemkes, Kemendikdasmen</span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="space-y-2">
              <button
                type="button"
                onClick={handleWhatsApp}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-xs font-bold text-white shadow-xs transition-colors hover:bg-emerald-700"
              >
                <span>Bagikan ke WhatsApp</span>
                <span aria-hidden="true">&rarr;</span>
              </button>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-background px-3 text-xs font-semibold text-foreground hover:bg-secondary"
                >
                  <svg
                    viewBox="0 0 20 20"
                    className="size-4 text-muted-foreground"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M7 3.5A1.5 1.5 0 018.5 2h3.879a1.5 1.5 0 011.06.44l3.122 3.12a1.5 1.5 0 01.439 1.061V16.5A1.5 1.5 0 0115.5 18h-7A1.5 1.5 0 017 16.5v-13z" />
                    <path d="M4.5 6A1.5 1.5 0 003 7.5v10A1.5 1.5 0 004.5 19h7a1.5 1.5 0 001.5-1.5v-1h-1.5v1h-7v-10h1V6h-1z" />
                  </svg>
                  <span>{copied ? 'Teks Tersalin!' : 'Salin Data Lengkap'}</span>
                </button>

                <button
                  type="button"
                  onClick={handlePrint}
                  className="flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-border bg-background px-4 text-xs font-semibold text-foreground hover:bg-secondary"
                  title="Cetak atau simpan lembar dokumen resmi dalam format PDF"
                >
                  <svg
                    viewBox="0 0 20 20"
                    className="size-4 text-muted-foreground"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M5 4v3H4a2 2 0 00-2 2v3a2 2 0 002 2h1v2a1 1 0 001 1h8a1 1 0 001-1v-2h1a2 2 0 002-2V9a2 2 0 00-2-2h-1V4a1 1 0 00-1-1H6a1 1 0 00-1 1zm2 1h6v2H7V5zm8 8v3H5v-3h10zm-1-3a1 1 0 100-2 1 1 0 000 2z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span>Cetak Dokumen Resmi (PDF)</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
