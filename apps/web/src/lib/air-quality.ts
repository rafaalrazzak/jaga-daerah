import type { AirCategory } from '@jaga-daerah/contracts';

// Wording published in the ISPU application (`ispu_info`), stripped of its HTML.
// Baik has one sentence for everyone. The other categories name two groups.
export const AIR_ADVICE: Record<
  AirCategory,
  { label: string; range: string; sensitive: string | null; everyone: string }
> = {
  baik: {
    label: 'Baik',
    range: '0–50',
    sensitive: null,
    everyone: 'Sangat baik untuk melakukan kegiatan di luar ruangan.',
  },
  sedang: {
    label: 'Sedang',
    range: '51–100',
    sensitive: 'Kurangi aktivitas fisik yang terlalu lama atau berat.',
    everyone: 'Masih dapat beraktivitas di luar ruangan.',
  },
  tidak_sehat: {
    label: 'Tidak sehat',
    range: '101–200',
    sensitive:
      'Boleh beraktivitas di luar dengan rehat lebih sering dan aktivitas ringan. Amati gejala seperti batuk atau sesak napas. Penderita asma harus mengikuti petunjuk kesehatan dan membawa obat. Penderita penyakit jantung perlu mewaspadai gejala seperti palpitasi, sesak napas, atau kelelahan tidak biasa.',
    everyone: 'Kurangi aktivitas fisik yang terlalu lama di luar ruangan.',
  },
  sangat_tidak_sehat: {
    label: 'Sangat tidak sehat',
    range: '201–300',
    sensitive:
      'Hindari semua aktivitas di luar ruangan, perbanyak aktivitas di dalam ruangan atau jadwalkan ulang.',
    everyone:
      'Hindari aktivitas fisik terlalu lama di luar ruangan dan pertimbangkan beraktivitas di dalam ruangan.',
  },
  berbahaya: {
    label: 'Berbahaya',
    range: '≥ 300',
    sensitive: 'Tetap di dalam ruangan dan hanya melakukan sedikit aktivitas.',
    everyone: 'Hindari seluruh aktivitas di luar ruangan.',
  },
};

export const AIR_CATEGORY_ORDER = [
  'baik',
  'sedang',
  'tidak_sehat',
  'sangat_tidak_sehat',
  'berbahaya',
] as const satisfies readonly AirCategory[];
