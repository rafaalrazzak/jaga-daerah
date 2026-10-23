import { useMemo, useState } from 'react';

import { AUDIT_OPINIONS } from '@/lib/audit-opinions';
import { formatCount } from '@/lib/format';
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

export default function Leaderboard() {
  const [activeTab, setActiveTab] = useState<LeaderboardTab>('rumah-sakit');
  const [selectedProvince, setSelectedProvince] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortDescending, setSortDescending] = useState<boolean>(true);

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

  // Filtered & Sorted items
  const displayItems = useMemo(() => {
    let filtered = allItems;

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

    const direction = sortDescending ? -1 : 1;

    return filtered.toSorted((a, b) => {
      if (activeTab === 'rumah-sakit') {
        return (a.hospitalTotal - b.hospitalTotal) * direction;
      }
      if (activeTab === 'sekolah') {
        return (a.schoolTotal - b.schoolTotal) * direction;
      }
      if (activeTab === 'bencana') {
        return (a.disasterTotal - b.disasterTotal) * direction;
      }
      // Opini: WTP first
      const weightA = a.auditOpinion === 'WTP' ? 3 : a.auditOpinion === 'WDP' ? 2 : 1;
      const weightB = b.auditOpinion === 'WTP' ? 3 : b.auditOpinion === 'WDP' ? 2 : 1;
      return (weightA - weightB) * direction;
    });
  }, [allItems, selectedProvince, searchQuery, activeTab, sortDescending]);

  return (
    <div className="space-y-6">
      {/* Category Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-border pb-4">
        <button
          type="button"
          onClick={() => setActiveTab('rumah-sakit')}
          className={`min-h-11 rounded-full px-4 text-xs font-bold transition-all sm:text-sm ${
            activeTab === 'rumah-sakit'
              ? 'bg-primary text-primary-foreground shadow-xs'
              : 'border border-border bg-card text-foreground hover:bg-secondary'
          }`}
        >
          🏥 Rumah Sakit
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('sekolah')}
          className={`min-h-11 rounded-full px-4 text-xs font-bold transition-all sm:text-sm ${
            activeTab === 'sekolah'
              ? 'bg-primary text-primary-foreground shadow-xs'
              : 'border border-border bg-card text-foreground hover:bg-secondary'
          }`}
        >
          🎓 Fasilitas Sekolah
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('bencana')}
          className={`min-h-11 rounded-full px-4 text-xs font-bold transition-all sm:text-sm ${
            activeTab === 'bencana'
              ? 'bg-primary text-primary-foreground shadow-xs'
              : 'border border-border bg-card text-foreground hover:bg-secondary'
          }`}
        >
          🚨 Bencana (BNPB 2024)
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('opini')}
          className={`min-h-11 rounded-full px-4 text-xs font-bold transition-all sm:text-sm ${
            activeTab === 'opini'
              ? 'bg-primary text-primary-foreground shadow-xs'
              : 'border border-border bg-card text-foreground hover:bg-secondary'
          }`}
        >
          ⚖️ Opini LKPD BPK RI
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
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Sort order toggle */}
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

      {/* Results Count Summary */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Menampilkan {displayItems.length} daerah</span>
        <span>Klik nama daerah untuk membuka profil lengkap & rincian APBD</span>
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
                  {activeTab === 'rumah-sakit' && 'Total Rumah Sakit'}
                  {activeTab === 'sekolah' && 'Total Sekolah'}
                  {activeTab === 'bencana' && 'Kejadian Bencana 2024'}
                  {activeTab === 'opini' && 'Opini BPK RI'}
                </th>
                <th className="px-4 py-3 text-right hidden md:table-cell">Jumlah Penduduk</th>
                <th className="px-4 py-3 text-center w-24">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {displayItems.slice(0, 100).map((item, idx) => {
                const rank = idx + 1;
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
                      {activeTab === 'rumah-sakit' && `${formatCount(item.hospitalTotal)} RS`}
                      {activeTab === 'sekolah' && `${formatCount(item.schoolTotal)} Sekolah`}
                      {activeTab === 'bencana' && `${formatCount(item.disasterTotal)} Kali`}
                      {activeTab === 'opini' && (
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
