import { GraduationCap, Hospital, Scale, TriangleAlert, X } from 'lucide-react';
import { useMemo, useState } from 'react';

import { AUDIT_OPINIONS } from '@/lib/audit-opinions';
import { formatCount } from '@/lib/format';
import { compareMetric, formatRate, perTenThousand } from '@/lib/leaderboard';
import type { LeaderboardBasis } from '@/lib/leaderboard';
import { LOCAL_SERVICES } from '@/lib/local-services';
import { NATURE } from '@/lib/nature';
import { REGIONS } from '@/lib/regions';

type LeaderboardTab = 'rumah-sakit' | 'sekolah' | 'bencana' | 'opini';

interface LeaderboardItem {
  code: string;
  name: string;
  slug: string;
  provinceCode: string;
  provinceName: string;
  population: number | null;
  hospitalTotal: number;
  schoolTotal: number;
  disasterTotal: number;
  auditOpinion: string;
}

function totalFor(item: LeaderboardItem, tab: LeaderboardTab): number {
  if (tab === 'rumah-sakit') return item.hospitalTotal;
  if (tab === 'sekolah') return item.schoolTotal;
  if (tab === 'bencana') return item.disasterTotal;
  return 0;
}

function TabIcon({ tab }: { tab: LeaderboardTab }) {
  const className = 'size-4 shrink-0';
  if (tab === 'rumah-sakit') return <Hospital className={className} aria-hidden="true" />;
  if (tab === 'sekolah') return <GraduationCap className={className} aria-hidden="true" />;
  if (tab === 'bencana') return <TriangleAlert className={className} aria-hidden="true" />;
  return <Scale className={className} aria-hidden="true" />;
}

export default function Leaderboard() {
  const [activeTab, setActiveTab] = useState<LeaderboardTab>('rumah-sakit');
  const [selectedProvince, setSelectedProvince] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortDescending, setSortDescending] = useState<boolean>(true);
  // Opini is a label, not a count, so it has no per-capita form.
  const [basis, setBasis] = useState<LeaderboardBasis>('total');
  const rateAvailable = activeTab !== 'opini';
  const useRate = rateAvailable && basis === 'per-10000';

  // Provinces list
  const provinces = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of REGIONS) {
      if (!map.has(r.province.code)) {
        map.set(r.province.code, r.province.name);
      }
    }
    return Array.from(map.entries())
      .map(([code, name]) => ({ code, name }))
      .toSorted((a, b) => a.name.localeCompare(b.name, 'id'));
  }, []);

  // Pre-compiled dataset
  const allItems = useMemo<LeaderboardItem[]>(() => {
    return REGIONS.map((r) => {
      const services = LOCAL_SERVICES.regions[r.code];
      const nature = NATURE.regions[r.code];
      const audit = AUDIT_OPINIONS.regions[r.code]?.years?.[0]?.opinion ?? 'Belum tersedia';

      const hospitalTotal = services?.hospitals?.total ?? 0;
      const schoolTotal = services?.schools
        ? services.schools.sd + services.schools.smp + services.schools.sma + services.schools.smk
        : 0;
      const disasterTotal = nature?.events_by_year?.['2024'] ?? 0;
      const population = services?.population?.total ?? null;

      return {
        code: r.code,
        name: r.name,
        slug: r.slug,
        provinceCode: r.province.code,
        provinceName: r.province.name,
        population,
        hospitalTotal,
        schoolTotal,
        disasterTotal,
        auditOpinion: audit,
      };
    });
  }, []);

  // Full national ranking for the active tab, basis, and sort order. Rankings are assigned before
  // filtering so a search result keeps its real national rank instead of restarting at #1.
  const rankedItems = useMemo(() => {
    return allItems.toSorted((a, b) => {
      if (activeTab === 'opini') {
        // Opini: WTP first
        const weightA = a.auditOpinion === 'WTP' ? 3 : a.auditOpinion === 'WDP' ? 2 : 1;
        const weightB = b.auditOpinion === 'WTP' ? 3 : b.auditOpinion === 'WDP' ? 2 : 1;
        return (weightA - weightB) * (sortDescending ? -1 : 1);
      }
      const value = (item: LeaderboardItem) =>
        useRate
          ? perTenThousand(totalFor(item, activeTab), item.population)
          : totalFor(item, activeTab);
      return compareMetric(value(a), value(b), sortDescending);
    });
  }, [allItems, activeTab, sortDescending, useRate]);

  const rankByCode = useMemo(
    () => new Map(rankedItems.map((item, index) => [item.code, index + 1])),
    [rankedItems],
  );

  // Province and name filters keep the national order (and rank) from `rankedItems`.
  const displayItems = useMemo(() => {
    let filtered = rankedItems;

    if (selectedProvince !== 'ALL') {
      filtered = filtered.filter((item) => item.provinceCode === selectedProvince);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(
        (item) =>
          item.name.toLowerCase().includes(q) || item.provinceName.toLowerCase().includes(q),
      );
    }

    return filtered;
  }, [rankedItems, selectedProvince, searchQuery]);

  return (
    <div className="space-y-6">
      {/* Category Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-border pb-4">
        <button
          type="button"
          onClick={() => setActiveTab('rumah-sakit')}
          className={`inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-xs font-bold transition-all sm:text-sm ${
            activeTab === 'rumah-sakit'
              ? 'bg-primary text-primary-foreground shadow-xs'
              : 'border border-border bg-card text-foreground hover:bg-secondary'
          }`}
        >
          <TabIcon tab="rumah-sakit" />
          Rumah Sakit
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('sekolah')}
          className={`inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-xs font-bold transition-all sm:text-sm ${
            activeTab === 'sekolah'
              ? 'bg-primary text-primary-foreground shadow-xs'
              : 'border border-border bg-card text-foreground hover:bg-secondary'
          }`}
        >
          <TabIcon tab="sekolah" />
          Fasilitas Sekolah
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('bencana')}
          className={`inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-xs font-bold transition-all sm:text-sm ${
            activeTab === 'bencana'
              ? 'bg-primary text-primary-foreground shadow-xs'
              : 'border border-border bg-card text-foreground hover:bg-secondary'
          }`}
        >
          <TabIcon tab="bencana" />
          Bencana (BNPB 2024)
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('opini')}
          className={`inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-xs font-bold transition-all sm:text-sm ${
            activeTab === 'opini'
              ? 'bg-primary text-primary-foreground shadow-xs'
              : 'border border-border bg-card text-foreground hover:bg-secondary'
          }`}
        >
          <TabIcon tab="opini" />
          Opini LKPD BPK RI
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
          {/* Province select */}
          <div className="min-w-44">
            <label htmlFor="province-filter" className="sr-only">
              Filter Provinsi
            </label>
            <select
              id="province-filter"
              value={selectedProvince}
              onChange={(e) => setSelectedProvince(e.target.value)}
              className="min-h-11 w-full rounded-xl border border-input bg-background px-3 text-xs font-bold text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              <option value="ALL">Seluruh Indonesia (514 Daerah)</option>
              {provinces.map((p) => (
                <option key={p.code} value={p.code}>
                  Provinsi {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Search by region name */}
          <div className="relative flex-1">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari nama kabupaten atau kota…"
              aria-label="Cari nama daerah"
              className="min-h-11 w-full rounded-xl border border-input bg-background px-3.5 text-xs text-foreground outline-hidden focus:border-primary sm:text-sm"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Hapus kata kunci pencarian"
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        {/* Ranking basis and sort order */}
        <div className="flex flex-wrap items-center gap-2">
          {rateAvailable ? (
            <div
              role="group"
              aria-label="Dasar peringkat"
              className="inline-flex rounded-xl border border-border bg-background p-0.5"
            >
              <button
                type="button"
                aria-pressed={!useRate}
                onClick={() => setBasis('total')}
                className={`min-h-11 rounded-[10px] px-3 text-xs font-semibold transition-colors ${
                  useRate
                    ? 'text-muted-foreground hover:text-foreground'
                    : 'bg-secondary text-foreground'
                }`}
              >
                Total
              </button>
              <button
                type="button"
                aria-pressed={useRate}
                onClick={() => setBasis('per-10000')}
                className={`min-h-11 rounded-[10px] px-3 text-xs font-semibold transition-colors ${
                  useRate
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                per 10.000 penduduk
              </button>
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => setSortDescending(!sortDescending)}
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-border bg-background px-3.5 text-xs font-semibold text-foreground hover:bg-secondary"
          >
            <span>Urutan:</span>
            <span className="font-bold text-primary">
              {sortDescending ? 'Tertinggi ↓' : 'Terendah ↑'}
            </span>
          </button>
        </div>
      </div>

      {/* Results Count Summary */}
      <div className="space-y-1 text-xs text-muted-foreground">
        <div className="flex items-center justify-between gap-3">
          <span>Menampilkan {displayItems.length} daerah</span>
          <span>Klik nama daerah untuk membuka profil lengkap &amp; rincian APBD</span>
        </div>
        {useRate ? (
          <p>
            Angka per 10.000 penduduk memakai jumlah penduduk Dukcapil 31 Desember 2024. Daerah
            tanpa angka penduduk diletakkan di bawah, bukan dianggap nol.
          </p>
        ) : null}
        {searchQuery.trim() !== '' || selectedProvince !== 'ALL' ? (
          <p>
            Peringkat tetap mengikuti posisi nasional pada tab dan urutan ini, bukan hasil filter.
          </p>
        ) : null}
      </div>

      {/* Leaderboard Table / Cards */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/50 text-muted-foreground font-semibold">
                <th className="px-4 py-3 text-center w-14">#</th>
                <th className="px-4 py-3">Kabupaten / Kota</th>
                <th className="px-4 py-3">Provinsi</th>
                <th className="px-4 py-3 text-right">
                  {activeTab === 'rumah-sakit' &&
                    (useRate ? 'Rumah Sakit per 10.000 Penduduk' : 'Total Rumah Sakit')}
                  {activeTab === 'sekolah' &&
                    (useRate ? 'Sekolah per 10.000 Penduduk' : 'Total Sekolah')}
                  {activeTab === 'bencana' &&
                    (useRate ? 'Bencana per 10.000 Penduduk' : 'Kejadian Bencana 2024')}
                  {activeTab === 'opini' && 'Opini BPK RI'}
                </th>
                <th className="px-4 py-3 text-right hidden md:table-cell">Jumlah Penduduk</th>
                <th className="px-4 py-3 text-center w-24">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {displayItems.slice(0, 100).map((item) => {
                const rank = rankByCode.get(item.code) ?? 0;
                const total = totalFor(item, activeTab);
                const rate = useRate ? perTenThousand(total, item.population) : null;
                return (
                  <tr key={item.code} className="transition-colors hover:bg-secondary/40">
                    <td className="px-4 py-3 text-center font-bold">
                      {rank === 1 ? (
                        <span className="inline-flex size-6 items-center justify-center rounded-full bg-amber-400 font-black text-amber-950 text-xs">
                          1
                        </span>
                      ) : rank === 2 ? (
                        <span className="inline-flex size-6 items-center justify-center rounded-full bg-slate-300 font-black text-slate-900 text-xs">
                          2
                        </span>
                      ) : rank === 3 ? (
                        <span className="inline-flex size-6 items-center justify-center rounded-full bg-amber-700/80 font-black text-amber-100 text-xs">
                          3
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{rank}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <a
                        href={`/daerah/${item.slug}`}
                        className="font-bold text-foreground hover:text-primary hover:underline"
                      >
                        {item.name}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{item.provinceName}</td>
                    <td className="px-4 py-3 text-right font-extrabold text-foreground">
                      {activeTab === 'opini' ? (
                        <span
                          className={`rounded-md px-2 py-0.5 text-xs font-bold ${
                            item.auditOpinion === 'WTP'
                              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                              : item.auditOpinion === 'WDP'
                                ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                                : 'bg-secondary text-muted-foreground'
                          }`}
                        >
                          {item.auditOpinion}
                        </span>
                      ) : useRate ? (
                        rate === null ? (
                          <span className="font-medium text-muted-foreground">—</span>
                        ) : (
                          <>
                            <span>{formatRate(rate)}</span>
                            <span className="block text-[11px] font-medium text-muted-foreground">
                              {formatCount(total)} total
                            </span>
                          </>
                        )
                      ) : activeTab === 'rumah-sakit' ? (
                        `${formatCount(total)} RS`
                      ) : activeTab === 'sekolah' ? (
                        `${formatCount(total)} Sekolah`
                      ) : (
                        `${formatCount(total)} Kali`
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground hidden md:table-cell">
                      {item.population ? `${formatCount(item.population)} jiwa` : '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <a
                        href={`/daerah/${item.slug}`}
                        className="inline-flex min-h-8 items-center rounded-lg bg-secondary px-2.5 text-xs font-semibold text-foreground hover:bg-primary hover:text-primary-foreground"
                      >
                        Buka &rarr;
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {displayItems.length > 100 && (
          <div className="border-t border-border bg-secondary/30 p-3 text-center text-xs text-muted-foreground">
            Menampilkan 100 daerah teratas. Gunakan filter provinsi atau pencarian nama untuk
            menemukan daerah tertentu.
          </div>
        )}

        {displayItems.length === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Tidak ditemukan daerah yang cocok dengan kata kunci &quot;{searchQuery}&quot;.
          </div>
        )}
      </div>
    </div>
  );
}
