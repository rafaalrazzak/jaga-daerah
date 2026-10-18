import { Skeleton } from '@almach/ui/skeleton';
import type { RegionProfile, RegionSummary } from '@jaga-daerah/contracts';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { AUDIT_OPINIONS } from '@/lib/audit-opinions';
import { formatCount, formatPercent, formatRupiahShort } from '@/lib/format';
import { LOCAL_SERVICES } from '@/lib/local-services';
import { REGIONS } from '@/lib/regions';
import { apiClient } from '@/lib/api-client';
import type { ApiClient } from '@/lib/api-client';
import { createQueryClient, profileQueryKeys } from '@/lib/query-client';

const PRESETS = [
  {
    label: 'Kota Bandung vs Kab. Bandung',
    slug1: 'kota-bandung',
    slug2: 'kabupaten-bandung',
  },
  {
    label: 'Kota Surabaya vs Kota Malang',
    slug1: 'kota-surabaya',
    slug2: 'kota-malang',
  },
  {
    label: 'Kota Medan vs Kota Padang',
    slug1: 'kota-medan',
    slug2: 'kota-padang',
  },
  {
    label: 'Kota Makassar vs Kota Jayapura',
    slug1: 'kota-makassar',
    slug2: 'kota-jayapura',
  },
] as const;

export interface CompareRegionsProps {
  initialRegion1?: string;
  initialRegion2?: string;
  client?: Pick<ApiClient, 'getRegionProfile'>;
  queryClient?: QueryClient;
}

function getInitialSlug(paramKey: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const val = new URLSearchParams(window.location.search).get(paramKey);
  if (val && REGIONS.some((r) => r.slug === val)) return val;
  return fallback;
}

function updateUrlParams(slug1: string, slug2: string) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.set('daerah1', slug1);
  url.searchParams.set('daerah2', slug2);
  window.history.replaceState(null, '', url.toString());
}

interface RegionSelectProps {
  id: string;
  label: string;
  selectedSlug: string;
  onSelect: (slug: string) => void;
  otherSlug: string;
}

function RegionSelect({ id, label, selectedSlug, onSelect, otherSlug }: RegionSelectProps) {
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState(false);

  const selectedRegion = REGIONS.find((r) => r.slug === selectedSlug);

  const filteredRegions = useMemo(() => {
    const query = filter.toLowerCase().trim();
    if (!query) return REGIONS.slice(0, 30);
    return REGIONS.filter(
      (r) =>
        r.name.toLowerCase().includes(query) ||
        r.province.name.toLowerCase().includes(query) ||
        r.code.includes(query),
    ).slice(0, 30);
  }, [filter]);

  return (
    <div className="relative">
      <label
        htmlFor={id}
        className="block text-xs font-bold tracking-wider text-muted-foreground uppercase"
      >
        {label}
      </label>
      <div className="mt-1.5 flex gap-2">
        <button
          type="button"
          id={id}
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex min-h-12 w-full items-center justify-between rounded-xl border border-input bg-card px-4 py-2.5 text-left text-sm font-semibold shadow-xs hover:border-foreground/30 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <span className="truncate">
            {selectedRegion
              ? `${selectedRegion.name} (${selectedRegion.province.name})`
              : 'Pilih daerah…'}
          </span>
          <svg
            viewBox="0 0 20 20"
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          >
            <path
              fill="currentColor"
              d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            />
          </svg>
        </button>
      </div>

      {open && (
        <div className="absolute z-30 mt-1 w-full rounded-2xl border border-border bg-popover p-2 shadow-xl">
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Cari nama kabupaten/kota…"
            className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-hidden focus:border-foreground/40"
            autoFocus
          />
          <ul className="mt-2 max-h-60 overflow-y-auto" role="listbox">
            {filteredRegions.length === 0 ? (
              <li className="p-3 text-center text-sm text-muted-foreground">
                Daerah tidak ditemukan.
              </li>
            ) : (
              filteredRegions.map((region) => {
                const isSelected = region.slug === selectedSlug;
                const isOther = region.slug === otherSlug;
                return (
                  <li key={region.code}>
                    <button
                      type="button"
                      disabled={isOther}
                      onClick={() => {
                        onSelect(region.slug);
                        setOpen(false);
                        setFilter('');
                      }}
                      className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${
                        isSelected
                          ? 'bg-accent font-bold text-accent-foreground'
                          : isOther
                            ? 'cursor-not-allowed text-muted-foreground/50'
                            : 'hover:bg-secondary'
                      }`}
                    >
                      <span className="truncate">
                        {region.name}
                        <span className="ml-1.5 text-xs text-muted-foreground">
                          ({region.province.name})
                        </span>
                      </span>
                      {isOther && (
                        <span className="text-xs text-muted-foreground">(Sudah dipilih)</span>
                      )}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

interface RegionMetrics {
  profile: RegionProfile | undefined;
  isLoading: boolean;
  isError: boolean;
  regionSummary: RegionSummary | undefined;
}

function ComparisonCard({
  title,
  subtitle,
  region1Value,
  region2Value,
  region1Sub,
  region2Sub,
}: {
  title: string;
  subtitle?: string;
  region1Value: React.ReactNode;
  region2Value: React.ReactNode;
  region1Sub?: string;
  region2Sub?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-5 shadow-xs">
      <div className="mb-3 text-center sm:text-left">
        <h3 className="text-sm font-bold text-foreground">{title}</h3>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      <div className="grid grid-cols-2 gap-3 divide-x divide-border">
        <div className="pr-2">
          <div className="text-base font-extrabold sm:text-lg text-foreground">{region1Value}</div>
          {region1Sub && <div className="mt-0.5 text-xs text-muted-foreground">{region1Sub}</div>}
        </div>
        <div className="pl-4">
          <div className="text-base font-extrabold sm:text-lg text-foreground">{region2Value}</div>
          {region2Sub && <div className="mt-0.5 text-xs text-muted-foreground">{region2Sub}</div>}
        </div>
      </div>
    </div>
  );
}

function safeRupiah(value?: string | null): string {
  return value ? formatRupiahShort(value) : 'Data belum tersedia';
}

function safePercent(value?: string | null): string {
  return value ? formatPercent(value) : 'Data belum tersedia';
}

function safeCount(value?: number | null, suffix = ''): string {
  if (value === null || value === undefined) return 'Data belum tersedia';
  return `${formatCount(value)}${suffix ? ' ' + suffix : ''}`;
}

function getBreakdown(profile?: RegionProfile, typeName?: string) {
  if (!profile) return undefined;
  return profile.expenditure_breakdown.by_type.find((item) => item.type === typeName);
}

function getHospitalRatio(hospitals: number | undefined, population: number | undefined) {
  if (!hospitals || !population || population === 0) return null;
  return ((hospitals / population) * 100_000).toFixed(1);
}

function getTotalSchools(services?: (typeof LOCAL_SERVICES.regions)[string]) {
  if (!services?.schools) return null;
  return services.schools.sd + services.schools.smp + services.schools.sma + services.schools.smk;
}

function CompareBody({ client }: { client: Pick<ApiClient, 'getRegionProfile'> }) {
  const [slug1, setSlug1] = useState(() => getInitialSlug('daerah1', 'kota-bandung'));
  const [slug2, setSlug2] = useState(() => getInitialSlug('daerah2', 'kabupaten-bandung'));

  const selectRegion1 = (slug: string) => {
    setSlug1(slug);
    updateUrlParams(slug, slug2);
  };

  const selectRegion2 = (slug: string) => {
    setSlug2(slug);
    updateUrlParams(slug1, slug);
  };

  const handleSwap = () => {
    setSlug1(slug2);
    setSlug2(slug1);
    updateUrlParams(slug2, slug1);
  };

  const region1Summary = REGIONS.find((r) => r.slug === slug1);
  const region2Summary = REGIONS.find((r) => r.slug === slug2);

  const query1 = useQuery({
    queryKey: profileQueryKeys.region(slug1, undefined),
    queryFn: ({ signal }) => client.getRegionProfile(slug1, { signal }),
  });

  const query2 = useQuery({
    queryKey: profileQueryKeys.region(slug2, undefined),
    queryFn: ({ signal }) => client.getRegionProfile(slug2, { signal }),
  });

  const r1Metrics: RegionMetrics = {
    profile: query1.data?.data,
    isLoading: query1.isLoading,
    isError: query1.isError,
    regionSummary: region1Summary,
  };

  const r2Metrics: RegionMetrics = {
    profile: query2.data?.data,
    isLoading: query2.isLoading,
    isError: query2.isError,
    regionSummary: region2Summary,
  };

  // Local services data
  const r1Services = region1Summary ? LOCAL_SERVICES.regions[region1Summary.code] : undefined;
  const r2Services = region2Summary ? LOCAL_SERVICES.regions[region2Summary.code] : undefined;

  // BPK Audit Opinions
  const r1Audit = region1Summary
    ? (AUDIT_OPINIONS.regions[region1Summary.code]?.years?.[0]?.opinion ?? 'Data belum tersedia')
    : 'Data belum tersedia';
  const r2Audit = region2Summary
    ? (AUDIT_OPINIONS.regions[region2Summary.code]?.years?.[0]?.opinion ?? 'Data belum tersedia')
    : 'Data belum tersedia';

  const r1Pegawai = getBreakdown(r1Metrics.profile, 'belanja_pegawai');
  const r2Pegawai = getBreakdown(r2Metrics.profile, 'belanja_pegawai');

  const r1Modal = getBreakdown(r1Metrics.profile, 'belanja_modal');
  const r2Modal = getBreakdown(r2Metrics.profile, 'belanja_modal');

  const r1HospitalRatio = getHospitalRatio(
    r1Services?.hospitals?.total,
    r1Services?.population?.total,
  );
  const r2HospitalRatio = getHospitalRatio(
    r2Services?.hospitals?.total,
    r2Services?.population?.total,
  );

  const r1Schools = getTotalSchools(r1Services);
  const r2Schools = getTotalSchools(r2Services);

  return (
    <div className="space-y-8">
      {/* Preset Buttons */}
      <div>
        <span className="text-xs font-semibold text-muted-foreground">
          Contoh perbandingan cepat:
        </span>
        <div className="mt-2 flex flex-wrap gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => {
                setSlug1(preset.slug1);
                setSlug2(preset.slug2);
                updateUrlParams(preset.slug1, preset.slug2);
              }}
              className="inline-flex min-h-9 items-center rounded-full border border-border bg-background px-3 text-xs font-semibold text-foreground hover:bg-secondary focus-visible:outline-3 focus-visible:outline-ring"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Selectors Bar */}
      <div className="rounded-2xl border border-border bg-card p-4 sm:p-6 shadow-sm">
        <div className="grid items-end gap-4 md:grid-cols-[1fr_auto_1fr]">
          <RegionSelect
            id="daerah-1-select"
            label="Daerah Pertama"
            selectedSlug={slug1}
            onSelect={selectRegion1}
            otherSlug={slug2}
          />

          <div className="flex justify-center pb-1">
            <button
              type="button"
              onClick={handleSwap}
              title="Tukar posisi daerah"
              aria-label="Tukar posisi kedua daerah"
              className="inline-flex size-11 items-center justify-center rounded-full border border-border bg-secondary hover:bg-secondary/80 focus-visible:outline-3 focus-visible:outline-ring"
            >
              <svg viewBox="0 0 20 20" className="size-5 text-foreground" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M6.3 3.3a1 1 0 011.4 0l3 3a1 1 0 01-1.4 1.4L8 6.4V13a1 1 0 11-2 0V6.4L4.7 7.7a1 1 0 01-1.4-1.4l3-3zm7.4 13.4a1 1 0 01-1.4 0l-3-3a1 1 0 011.4-1.4l1.3 1.3V7a1 1 0 112 0v6.6l1.3-1.3a1 1 0 011.4 1.4l-3 3z"
                />
              </svg>
            </button>
          </div>

          <RegionSelect
            id="daerah-2-select"
            label="Daerah Kedua"
            selectedSlug={slug2}
            onSelect={selectRegion2}
            otherSlug={slug1}
          />
        </div>
      </div>

      {/* Comparison Header Labels */}
      <div className="grid grid-cols-2 gap-4 rounded-2xl bg-secondary p-4 text-center sm:p-6">
        <div>
          <span className="text-xs font-bold tracking-wider text-muted-foreground uppercase">
            {region1Summary?.type === 'kota' ? 'Kota' : 'Kabupaten'}
          </span>
          <h2 className="mt-1 text-xl font-extrabold text-foreground sm:text-2xl">
            {region1Summary?.name}
          </h2>
          <p className="text-xs text-muted-foreground sm:text-sm">
            Provinsi {region1Summary?.province.name}
          </p>
          <a
            href={`/daerah/${slug1}`}
            className="mt-3 inline-flex min-h-9 items-center rounded-full bg-primary/10 px-3 text-xs font-bold text-primary hover:bg-primary/20"
          >
            Buka profil lengkap &rarr;
          </a>
        </div>
        <div>
          <span className="text-xs font-bold tracking-wider text-muted-foreground uppercase">
            {region2Summary?.type === 'kota' ? 'Kota' : 'Kabupaten'}
          </span>
          <h2 className="mt-1 text-xl font-extrabold text-foreground sm:text-2xl">
            {region2Summary?.name}
          </h2>
          <p className="text-xs text-muted-foreground sm:text-sm">
            Provinsi {region2Summary?.province.name}
          </p>
          <a
            href={`/daerah/${slug2}`}
            className="mt-3 inline-flex min-h-9 items-center rounded-full bg-primary/10 px-3 text-xs font-bold text-primary hover:bg-primary/20"
          >
            Buka profil lengkap &rarr;
          </a>
        </div>
      </div>

      {/* Category: Anggaran & Keuangan */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 border-b border-border pb-2">
          <svg
            viewBox="0 0 24 24"
            className="size-5 text-primary"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <h3 className="text-base font-extrabold text-foreground">Keuangan Daerah (APBD)</h3>
          <span className="text-xs text-muted-foreground ml-auto">Sumber: DJPK Kemenkeu</span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <ComparisonCard
            title="Total Realisasi Belanja"
            subtitle="Uang kas yang dibelanjakan daerah"
            region1Value={
              r1Metrics.isLoading ? (
                <Skeleton className="h-6 w-24" />
              ) : (
                safeRupiah(r1Metrics.profile?.budget.realization_amount)
              )
            }
            region2Value={
              r2Metrics.isLoading ? (
                <Skeleton className="h-6 w-24" />
              ) : (
                safeRupiah(r2Metrics.profile?.budget.realization_amount)
              )
            }
            region1Sub={
              r1Metrics.profile?.budget.budget_amount
                ? `Pagu: ${formatRupiahShort(r1Metrics.profile.budget.budget_amount)}`
                : ''
            }
            region2Sub={
              r2Metrics.profile?.budget.budget_amount
                ? `Pagu: ${formatRupiahShort(r2Metrics.profile.budget.budget_amount)}`
                : ''
            }
          />

          <ComparisonCard
            title="Persentase Realisasi Belanja"
            subtitle="Dibanding median nasional kabupaten/kota"
            region1Value={
              r1Metrics.isLoading ? (
                <Skeleton className="h-6 w-16" />
              ) : (
                safePercent(r1Metrics.profile?.budget.realization_percent)
              )
            }
            region2Value={
              r2Metrics.isLoading ? (
                <Skeleton className="h-6 w-16" />
              ) : (
                safePercent(r2Metrics.profile?.budget.realization_percent)
              )
            }
            region1Sub={
              r1Metrics.profile
                ? r1Metrics.profile.budget.median_comparison === 'above'
                  ? 'Di atas median nasional'
                  : 'Di bawah median nasional'
                : ''
            }
            region2Sub={
              r2Metrics.profile
                ? r2Metrics.profile.budget.median_comparison === 'above'
                  ? 'Di atas median nasional'
                  : 'Di bawah median nasional'
                : ''
            }
          />

          <ComparisonCard
            title="Belanja Pegawai (Aparatur)"
            subtitle="Gaji dan tunjangan pegawai daerah"
            region1Value={
              r1Metrics.isLoading ? (
                <Skeleton className="h-6 w-20" />
              ) : (
                safePercent(r1Pegawai?.realization_share_percent)
              )
            }
            region2Value={
              r2Metrics.isLoading ? (
                <Skeleton className="h-6 w-20" />
              ) : (
                safePercent(r2Pegawai?.realization_share_percent)
              )
            }
            region1Sub={
              r1Pegawai?.realization_amount ? formatRupiahShort(r1Pegawai.realization_amount) : ''
            }
            region2Sub={
              r2Pegawai?.realization_amount ? formatRupiahShort(r2Pegawai.realization_amount) : ''
            }
          />

          <ComparisonCard
            title="Belanja Modal (Pembangunan)"
            subtitle="Pembangunan infrastruktur, aset, dan sarana"
            region1Value={
              r1Metrics.isLoading ? (
                <Skeleton className="h-6 w-20" />
              ) : (
                safePercent(r1Modal?.realization_share_percent)
              )
            }
            region2Value={
              r2Metrics.isLoading ? (
                <Skeleton className="h-6 w-20" />
              ) : (
                safePercent(r2Modal?.realization_share_percent)
              )
            }
            region1Sub={
              r1Modal?.realization_amount ? formatRupiahShort(r1Modal.realization_amount) : ''
            }
            region2Sub={
              r2Modal?.realization_amount ? formatRupiahShort(r2Modal.realization_amount) : ''
            }
          />

          <ComparisonCard
            title="Dana Bagi Hasil (DBH SDA)"
            subtitle="Bagi hasil minyak, gas, minerba, kehutanan, dll."
            region1Value={
              r1Metrics.isLoading ? (
                <Skeleton className="h-6 w-20" />
              ) : (
                safeRupiah(r1Metrics.profile?.natural_resources.total_realization_amount)
              )
            }
            region2Value={
              r2Metrics.isLoading ? (
                <Skeleton className="h-6 w-20" />
              ) : (
                safeRupiah(r2Metrics.profile?.natural_resources.total_realization_amount)
              )
            }
            region1Sub="Transfer dari pusat"
            region2Sub="Transfer dari pusat"
          />

          <ComparisonCard
            title="Opini BPK RI"
            subtitle="Pemeriksaan atas Laporan Keuangan (LKPD)"
            region1Value={
              <span className="inline-flex items-center rounded-lg bg-primary/10 px-2.5 py-1 text-sm font-bold text-primary">
                {r1Audit}
              </span>
            }
            region2Value={
              <span className="inline-flex items-center rounded-lg bg-primary/10 px-2.5 py-1 text-sm font-bold text-primary">
                {r2Audit}
              </span>
            }
            region1Sub="Tahun laporan terakhir"
            region2Sub="Tahun laporan terakhir"
          />
        </div>
      </div>

      {/* Category: Layanan Publik & Penduduk */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 border-b border-border pb-2">
          <svg
            viewBox="0 0 24 24"
            className="size-5 text-primary"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
            />
          </svg>
          <h3 className="text-base font-extrabold text-foreground">
            Kependudukan & Layanan Publik
          </h3>
          <span className="text-xs text-muted-foreground ml-auto">
            Sumber: Dukcapil, SIRS Kemenkes, Kemendikdasmen
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <ComparisonCard
            title="Jumlah Penduduk"
            subtitle="Catatan Dukcapil per 31 Desember 2024"
            region1Value={
              r1Services?.population?.total
                ? `${formatCount(r1Services.population.total)} jiwa`
                : 'Data belum tersedia'
            }
            region2Value={
              r2Services?.population?.total
                ? `${formatCount(r2Services.population.total)} jiwa`
                : 'Data belum tersedia'
            }
          />

          <ComparisonCard
            title="Jumlah Rumah Sakit"
            subtitle="RS Umum, Ibu & Anak, Khusus (SIRS)"
            region1Value={
              r1Services?.hospitals?.total
                ? `${formatCount(r1Services.hospitals.total)} RS`
                : '0 RS'
            }
            region2Value={
              r2Services?.hospitals?.total
                ? `${formatCount(r2Services.hospitals.total)} RS`
                : '0 RS'
            }
            region1Sub={r1HospitalRatio ? `~${r1HospitalRatio} RS per 100 rb penduduk` : ''}
            region2Sub={r2HospitalRatio ? `~${r2HospitalRatio} RS per 100 rb penduduk` : ''}
          />

          <ComparisonCard
            title="Jumlah Satuan Pendidikan"
            subtitle="Total sekolah SD, SMP, SMA, SMK"
            region1Value={
              r1Schools !== null ? `${formatCount(r1Schools)} sekolah` : 'Data belum tersedia'
            }
            region2Value={
              r2Schools !== null ? `${formatCount(r2Schools)} sekolah` : 'Data belum tersedia'
            }
            region1Sub={
              r1Services?.schools
                ? `SD: ${r1Services.schools.sd}, SMP: ${r1Services.schools.smp}, SMA: ${r1Services.schools.sma}, SMK: ${r1Services.schools.smk}`
                : ''
            }
            region2Sub={
              r2Services?.schools
                ? `SD: ${r2Services.schools.sd}, SMP: ${r2Services.schools.smp}, SMA: ${r2Services.schools.sma}, SMK: ${r2Services.schools.smk}`
                : ''
            }
          />

          <ComparisonCard
            title="Bencana di Provinsi (BNPB)"
            subtitle="Catatan bencana tingkat provinsi"
            region1Value={
              r1Metrics.isLoading ? (
                <Skeleton className="h-6 w-20" />
              ) : (
                safeCount(r1Metrics.profile?.disaster?.totals.event_count, 'kejadian')
              )
            }
            region2Value={
              r2Metrics.isLoading ? (
                <Skeleton className="h-6 w-20" />
              ) : (
                safeCount(r2Metrics.profile?.disaster?.totals.event_count, 'kejadian')
              )
            }
            region1Sub={
              r1Metrics.profile?.disaster
                ? safeCount(r1Metrics.profile.disaster.totals.affected, 'warga terdampak')
                : ''
            }
            region2Sub={
              r2Metrics.profile?.disaster
                ? safeCount(r2Metrics.profile.disaster.totals.affected, 'warga terdampak')
                : ''
            }
          />
        </div>
      </div>

      {/* Note about reading neutrality */}
      <div className="rounded-2xl border border-border bg-card p-4 text-xs leading-relaxed text-muted-foreground sm:p-5">
        <strong className="font-semibold text-foreground">
          Catatan Cara Membaca Perbandingan:
        </strong>{' '}
        Perbandingan di atas disajikan dari kompilasi publikasi resmi DJPK Kemenkeu, Ditjen Dukcapil
        Kemendagri, SIRS Kemenkes, Kemendikdasmen, BPK RI, dan BNPB. JagaDaerah tidak menilai atau
        menghakimi baik-buruknya kinerja pemerintah daerah. Angka yang belum tersedia pada sumber
        resmi dikosongkan secara eksplisit.
      </div>
    </div>
  );
}

const defaultQueryClient = createQueryClient();

export default function CompareRegions({
  client = apiClient,
  queryClient = defaultQueryClient,
}: CompareRegionsProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <CompareBody client={client} />
    </QueryClientProvider>
  );
}
