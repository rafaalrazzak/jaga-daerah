// Indonesian number formatting for public figures (PRD §7.5). Rupiah arrives as a decimal string
// ("8345231335444.90"); all rupiah formatting stays in BigInt so large values never lose precision.

const RUPIAH_PATTERN = /^(\d+)\.(\d{2})$/;
const SCALES = [
  { divisor: 10n ** 12n, label: 'triliun' },
  { divisor: 10n ** 9n, label: 'miliar' },
  { divisor: 10n ** 6n, label: 'juta' },
] as const;

function parseRupiah(amount: string): { rupiah: bigint; cents: string } {
  const match = RUPIAH_PATTERN.exec(amount);
  if (match === null) {
    throw new Error(`Not a rupiah decimal string: ${amount}`);
  }
  return { rupiah: BigInt(match[1] ?? '0'), cents: match[2] ?? '00' };
}

function groupThousands(value: bigint): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** "8345231335444.90" → "Rp8.345.231.335.444,90" */
export function formatRupiahFull(amount: string): string {
  const { rupiah, cents } = parseRupiah(amount);
  return `Rp${groupThousands(rupiah)},${cents}`;
}

/** "8345231335444.90" → "Rp8,35 triliun" (two decimals, rounded half up). */
export function formatRupiahShort(amount: string): string {
  const { rupiah } = parseRupiah(amount);
  for (const { divisor, label } of SCALES) {
    // Round first, then pick the scale, so 999.999.999 becomes "1,00 miliar", not "1.000,00 juta".
    const hundredths = (rupiah * 100n * 2n + divisor) / (divisor * 2n);
    if (hundredths >= 100n) {
      const fraction = (hundredths % 100n).toString().padStart(2, '0');
      return `Rp${groupThousands(hundredths / 100n)},${fraction} ${label}`;
    }
  }
  return `Rp${groupThousands(rupiah)}`;
}

/** "89.8" → "89,8%" */
export function formatPercent(percent: string): string {
  return `${percent.replace('.', ',')}%`;
}

const NUMBER_FORMAT = new Intl.NumberFormat('id-ID');

export function formatCount(value: number): string {
  return NUMBER_FORMAT.format(value);
}

const DATE_FORMAT = new Intl.DateTimeFormat('id-ID', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Asia/Jakarta',
});

export function formatDate(iso: string): string {
  return DATE_FORMAT.format(new Date(iso));
}
