import type { IndonesianTimeZone } from '@jaga-daerah/contracts';

const ZONE_LABEL: Record<IndonesianTimeZone, string> = {
  'Asia/Jakarta': 'WIB',
  'Asia/Makassar': 'WITA',
  'Asia/Jayapura': 'WIT',
};

/** Formatter for "09.00 WIB" (or "Sab 18 Okt 09.00 WIB" with `withDay`) in the region's zone. */
export function timeFormatter(zone: IndonesianTimeZone, withDay = false): (iso: string) => string {
  const format = new Intl.DateTimeFormat('id-ID', {
    ...(withDay ? { weekday: 'short', day: 'numeric', month: 'short' } : {}),
    hour: '2-digit',
    minute: '2-digit',
    timeZone: zone,
  });
  return (iso) => `${format.format(new Date(iso)).replace(',', '')} ${ZONE_LABEL[zone]}`;
}

/** "Sabtu, 18 Oktober" in the region's zone. */
export function dayLabel(iso: string, zone: IndonesianTimeZone): string {
  return new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: zone,
  }).format(new Date(iso));
}

export function localHour(iso: string, zone: IndonesianTimeZone): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: zone }).format(
      new Date(iso),
    ),
  );
}
