import { Alert } from '@almach/ui/alert';
import type {
  Earthquake,
  LiveConditions,
  WarningSeverity,
  WeatherWarning,
} from '@jaga-daerah/contracts';
import type { ReactNode } from 'react';

import type { HotspotDistribution } from '@/components/live/geo';
import { timeFormatter } from '@/components/live/time';
import { Disclosure, ExternalLink, LiveDot } from '@/components/ui/Primitives';
import { formatCount } from '@/lib/format';

export const BMKG_URL = 'https://www.bmkg.go.id/';
export const FIRMS_URL = 'https://firms.modaps.eosdis.nasa.gov/map/';
// A quake is raised to the alert list at this magnitude, or whenever BMKG's own text mentions a
// tsunami potential other than "tidak berpotensi". Smaller felt quakes stay in the side panel.
const QUAKE_ALERT_MAGNITUDE = 5;

type Tone = 'danger' | 'warning' | 'info';

const SEVERITY: Record<WarningSeverity, { tone: Tone; label: string }> = {
  Extreme: { tone: 'danger', label: 'Sangat berbahaya' },
  Severe: { tone: 'danger', label: 'Berbahaya' },
  Moderate: { tone: 'warning', label: 'Waspada' },
  Minor: { tone: 'info', label: 'Perhatian' },
  Unknown: { tone: 'info', label: 'Perhatian' },
};

const TONE: Record<Tone, { variant: 'destructive' | 'warning' | 'default'; fill: string }> = {
  danger: { variant: 'destructive', fill: 'bg-destructive' },
  warning: { variant: 'warning', fill: 'bg-warning' },
  info: { variant: 'default', fill: 'bg-primary' },
};

const ICON_PATHS = {
  weather: 'M7 14h10a4.5 4.5 0 0 0 .5-9 6 6 0 0 0-11.5 2A3.5 3.5 0 0 0 7 14Zm6-1-3 5h4l-3 5',
  fire: 'M12 22c4 0 7-2.7 7-6.6 0-3.2-2-5.6-3.6-7.4-.4 2-1.4 3.2-2.6 3.6.3-3.4-1.2-6.6-4-9.6.2 3.6-2 6-3.5 8A7.6 7.6 0 0 0 5 15.4C5 19.3 8 22 12 22Z',
  quake: 'M2 12h4l2-6 3 12 3-9 2 3h6',
} as const;

interface AlertItem {
  key: string;
  tone: Tone;
  kind: keyof typeof ICON_PATHS;
  label: string;
  title: string;
  body: ReactNode;
}

function AlertIcon({ kind, tone }: { kind: AlertItem['kind']; tone: Tone }) {
  const { fill } = TONE[tone];
  return (
    <span
      aria-hidden="true"
      className={`relative grid size-11 shrink-0 place-items-center rounded-full text-white ${fill}`}
    >
      {/* Live signal while a warning is in force; motion-safe drops it for reduced motion. */}
      {tone === 'info' ? null : (
        <span
          className={`absolute inset-0 rounded-full opacity-40 motion-safe:animate-ping ${fill}`}
        />
      )}
      <svg
        viewBox="0 0 24 24"
        className="relative size-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={ICON_PATHS[kind]} />
      </svg>
    </span>
  );
}

function tsunamiMentioned(quake: Earthquake): boolean {
  return quake.tsunami !== null && !/tidak berpotensi/i.test(quake.tsunami);
}

function warningAlert(warning: WeatherWarning, at: (iso: string) => string): AlertItem {
  const severity = SEVERITY[warning.severity];
  return {
    key: warning.id,
    tone: severity.tone,
    kind: 'weather',
    label: `Peringatan dini BMKG · ${severity.label}`,
    title: warning.headline,
    body: (
      <>
        <p>
          <strong>Kecamatan terdampak:</strong> {warning.kecamatan.join(', ')}.
        </p>
        <p>
          Berlaku {at(warning.effective)} sampai {at(warning.expires)}.
        </p>
        <Disclosure summary="Baca peringatan lengkap dari BMKG">
          <p className="pb-2 whitespace-pre-line">{warning.description}</p>
        </Disclosure>
        <p className="flex flex-wrap gap-x-4">
          <ExternalLink href={warning.source_url}>Dokumen peringatan BMKG</ExternalLink>
          {warning.infographic_url === null ? null : (
            <ExternalLink href={warning.infographic_url}>Infografis BMKG</ExternalLink>
          )}
        </p>
      </>
    ),
  };
}

function quakeAlert(quake: Earthquake, at: (iso: string) => string): AlertItem {
  return {
    key: quake.time,
    tone: tsunamiMentioned(quake) ? 'danger' : 'warning',
    kind: 'quake',
    label: 'Gempa bumi · BMKG',
    title: `Gempa M${quake.magnitude.toLocaleString('id-ID')} sekitar ${formatCount(quake.distance_km)} km dari daerah ini`,
    body: (
      <>
        <p>
          {at(quake.time)} · {quake.place}
          {quake.depth_km === null ? '' : ` · kedalaman ${formatCount(quake.depth_km)} km`}
        </p>
        {quake.tsunami === null ? null : <p className="font-semibold">{quake.tsunami}</p>}
        {quake.felt === null ? null : <p>Dirasakan (skala MMI): {quake.felt}</p>}
      </>
    ),
  };
}

function hotspotAlert(
  data: LiveConditions,
  distribution: HotspotDistribution | null,
  at: (iso: string) => string,
): AlertItem | null {
  const { hotspots } = data;
  // Inside the kecamatan outlines when the map has loaded; otherwise the server's box count.
  const count = distribution?.count ?? hotspots.count;
  const high = distribution?.highConfidence ?? hotspots.high_confidence_count;
  if (hotspots.status !== 'ok' || count === 0) return null;
  const top = distribution?.byKecamatan.slice(0, 3) ?? [];
  return {
    key: 'hotspots',
    tone: 'warning',
    kind: 'fire',
    label: `Titik panas satelit · NASA FIRMS ${hotspots.instrument}`,
    title: `${formatCount(count)} titik panas terdeteksi ${
      distribution === null ? 'di sekitar' : 'di'
    } ${data.region.name} dalam ${hotspots.window_hours} jam terakhir`,
    body: (
      <>
        {top.length === 0 ? null : (
          <p>
            <strong>Terbanyak di:</strong>{' '}
            {top.map((entry) => `Kec. ${entry.name} (${formatCount(entry.count)})`).join(', ')}.
          </p>
        )}
        <p>
          {high > 0
            ? `${formatCount(high)} di antaranya bertingkat keyakinan tinggi. `
            : 'Tidak ada yang bertingkat keyakinan tinggi. '}
          {hotspots.latest_at === null ? null : `Deteksi terakhir ${at(hotspots.latest_at)}.`}
        </p>
        <p>
          Titik panas adalah deteksi panas dari satelit, belum tentu kebakaran hutan/lahan. Pantau
          informasi resmi BPBD setempat.
        </p>
        <p>
          <ExternalLink href={FIRMS_URL}>Lihat peta FIRMS</ExternalLink>
        </p>
      </>
    ),
  };
}

const RANK: Record<Tone, number> = { danger: 0, warning: 1, info: 2 };

/** Every active item, most severe first: BMKG warnings, hotspots, then strong quakes. */
function alertsFor(data: LiveConditions, distribution: HotspotDistribution | null): AlertItem[] {
  const at = timeFormatter(data.forecast.time_zone, true);
  const alerts = data.warnings.items.map((warning) => warningAlert(warning, at));
  const fire = hotspotAlert(data, distribution, at);
  if (fire !== null) alerts.push(fire);
  for (const quake of data.earthquakes.items) {
    if (quake.magnitude >= QUAKE_ALERT_MAGNITUDE || tsunamiMentioned(quake)) {
      alerts.push(quakeAlert(quake, at));
    }
  }
  return alerts.toSorted((left, right) => RANK[left.tone] - RANK[right.tone]);
}

export function LiveAlerts({
  data,
  distribution,
}: {
  data: LiveConditions;
  distribution: HotspotDistribution | null;
}) {
  const alerts = alertsFor(data, distribution);
  const checked = timeFormatter(data.forecast.time_zone)(data.fetched_at);

  if (alerts.length === 0) {
    return (
      <p className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 text-sm sm:p-5">
        <LiveDot className="mt-1.5" />
        <span>
          {data.warnings.status === 'ok' ? (
            <>
              <strong>Tidak ada peringatan dini cuaca aktif dari BMKG</strong> untuk kecamatan di{' '}
              {data.region.name} saat diperiksa pukul {checked}.
            </>
          ) : (
            <>
              <strong>Peringatan dini BMKG tidak dapat dimuat saat ini.</strong> Cek langsung di{' '}
              <ExternalLink href={BMKG_URL}>bmkg.go.id</ExternalLink>.
            </>
          )}{' '}
          <span className="text-muted-foreground">
            Ini bukan jaminan aman; ikuti arahan BMKG dan BPBD setempat.
          </span>
        </span>
      </p>
    );
  }

  return (
    <ul className="space-y-3" aria-label={`${alerts.length} peringatan aktif`}>
      {alerts.map((alert) => (
        <li key={alert.key}>
          <Alert
            variant={TONE[alert.tone].variant}
            className="items-start gap-4 rounded-2xl border-l-4 p-4 text-foreground motion-safe:animate-rise sm:p-5"
          >
            <AlertIcon kind={alert.kind} tone={alert.tone} />
            <Alert.Body className="min-w-0 space-y-2 text-sm leading-relaxed text-foreground">
              <p className="text-xs font-bold tracking-[0.08em] uppercase">{alert.label}</p>
              <Alert.Title className="text-lg leading-snug font-extrabold tracking-tight">
                {alert.title}
              </Alert.Title>
              {alert.body}
            </Alert.Body>
          </Alert>
        </li>
      ))}
    </ul>
  );
}
