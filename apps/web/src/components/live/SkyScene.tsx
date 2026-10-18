import type { Sky } from '@/components/live/sky';

// Animated background for the weather card. Purely decorative (aria-hidden) and drawn with CSS
// transforms/opacity only; every animation is `motion-safe:` so reduced motion shows a still scene.

const CLOUD = 'M18 40h52a14 14 0 0 0 0-28 20 20 0 0 0-38-4A16 16 0 0 0 18 40Z';

// Fixed pseudo-random layout, so server and client render the same scene.
const DROPS = Array.from({ length: 28 }, (_, index) => ({
  left: (index * 37) % 100,
  delay: ((index * 53) % 90) / 100,
  duration: 0.7 + ((index * 17) % 40) / 100,
}));
const STARS = Array.from({ length: 18 }, (_, index) => ({
  left: (index * 41 + 7) % 100,
  top: (index * 29 + 5) % 60,
  delay: ((index * 31) % 30) / 10,
}));

function Cloud({ className, tone }: { className: string; tone: string }) {
  return (
    <svg viewBox="0 0 88 44" className={`absolute ${className}`} aria-hidden="true">
      <path d={CLOUD} className={tone} />
    </svg>
  );
}

function Sun({ small = false }: { small?: boolean }) {
  return (
    <div
      className={`absolute opacity-90 ${small ? 'top-3 right-3 size-16' : 'top-3 right-3 size-20'}`}
    >
      <svg viewBox="0 0 100 100" className="size-full motion-safe:animate-spin-slow">
        {Array.from({ length: 12 }, (_, index) => (
          <rect
            key={index}
            x="48.5"
            y="2"
            width="3"
            height="14"
            rx="1.5"
            className="fill-amber-300/70"
            transform={`rotate(${index * 30} 50 50)`}
          />
        ))}
      </svg>
      <div className="absolute inset-[22%] rounded-full bg-amber-300 shadow-[0_0_60px_20px_rgba(252,211,77,0.55)]" />
    </div>
  );
}

function Clouds({ dark }: { dark: boolean }) {
  const tone = dark ? 'fill-slate-400/40' : 'fill-white/80';
  return (
    <>
      <Cloud className="top-4 left-[8%] w-40 motion-safe:animate-drift" tone={tone} />
      <Cloud className="top-16 right-[6%] w-56 motion-safe:animate-drift-slow" tone={tone} />
      <Cloud className="top-28 left-[40%] w-32 opacity-70 motion-safe:animate-drift" tone={tone} />
    </>
  );
}

function Rain({ heavy }: { heavy: boolean }) {
  return (
    <div className="absolute inset-0">
      {DROPS.slice(0, heavy ? DROPS.length : 18).map((drop) => (
        <span
          key={`${drop.left}-${drop.delay}`}
          className="absolute -top-6 h-6 w-px bg-sky-200/60 motion-safe:animate-fall"
          style={{
            left: `${drop.left}%`,
            animationDelay: `${drop.delay}s`,
            animationDuration: `${drop.duration}s`,
          }}
        />
      ))}
    </div>
  );
}

export function SkyScene({ sky }: { sky: Sky }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {sky === 'sun' ? <Sun /> : null}
      {sky === 'partly' ? (
        <>
          <Sun small />
          <Clouds dark={false} />
        </>
      ) : null}
      {sky === 'cloud' ? <Clouds dark={false} /> : null}
      {sky === 'fog' ? (
        <>
          {[20, 45, 70].map((top, index) => (
            <span
              key={top}
              className={`absolute -inset-x-1/4 h-8 rounded-full bg-white/50 blur-md ${
                index % 2 === 0 ? 'motion-safe:animate-drift' : 'motion-safe:animate-drift-slow'
              }`}
              style={{ top: `${top}%` }}
            />
          ))}
        </>
      ) : null}
      {sky === 'rain' || sky === 'storm' ? (
        <>
          <Clouds dark />
          <Rain heavy={sky === 'storm'} />
        </>
      ) : null}
      {sky === 'storm' ? (
        <span className="absolute inset-0 bg-white opacity-0 motion-safe:animate-flash" />
      ) : null}
      {sky === 'moon' ? (
        <>
          {STARS.map((star) => (
            <span
              key={`${star.left}-${star.top}`}
              className="absolute size-1 rounded-full bg-white/80 motion-safe:animate-twinkle"
              style={{
                left: `${star.left}%`,
                top: `${star.top}%`,
                animationDelay: `${star.delay}s`,
              }}
            />
          ))}
          <div className="absolute top-6 right-10 size-20 rounded-full bg-amber-50 shadow-[0_0_40px_10px_rgba(255,251,235,0.25)]">
            <div className="absolute top-2 left-5 size-20 rounded-full bg-indigo-950/90" />
          </div>
        </>
      ) : null}
    </div>
  );
}
