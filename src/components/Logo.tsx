/**
 * The Grainroom mark.
 *
 * A print coming up in the tray: the disc is solid on the left and breaks
 * apart into grain toward the right. That is the whole product argument in
 * one shape — a Look is invisible until it is applied, and what travels
 * between people is the grain, not the photograph.
 *
 * The dot field is generated rather than hand-placed so the density curve
 * stays honest at every size. Below about 20px the dots are dropped and the
 * disc reads as a solid aperture, which is what a favicon needs.
 */

interface MarkProps {
  size?: number;
  /** Drops the grain field for very small renders. */
  simplified?: boolean;
  className?: string;
}

const VB = 64;
const CENTER = 32;
const RADIUS = 22;

/** Deterministic dot field. Same seed, same mark, every build. */
function grainDots() {
  const dots: { x: number; y: number; r: number; o: number }[] = [];
  let seed = 20260808;
  const rand = () => {
    // xorshift, so the layout never drifts between environments
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return ((seed >>> 0) % 100000) / 100000;
  };

  for (let i = 0; i < 190; i++) {
    const x = rand() * VB;
    const y = rand() * VB;
    const dx = x - CENTER;
    const dy = y - CENTER;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Live in a band just outside the disc edge, biased to the right.
    if (dist < RADIUS * 0.72 || dist > RADIUS * 1.62) continue;
    const rightBias = (x - CENTER) / RADIUS;
    if (rand() > 0.18 + rightBias * 0.62) continue;

    dots.push({
      x: Number(x.toFixed(2)),
      y: Number(y.toFixed(2)),
      r: Number((0.5 + rand() * 1.5).toFixed(2)),
      o: Number((0.25 + rand() * 0.65).toFixed(2)),
    });
  }
  return dots;
}

const DOTS = grainDots();

export function Mark({ size = 32, simplified = false, className }: MarkProps) {
  const id = "gr-mark";
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${VB} ${VB}`}
      fill="none"
      className={className}
      role="img"
      aria-label="Grainroom"
    >
      <defs>
        {/* Safelight falling across the print from the upper left. */}
        <linearGradient id={`${id}-disc`} x1="14" y1="10" x2="50" y2="54">
          <stop offset="0%" stopColor="#ff8f4d" />
          <stop offset="45%" stopColor="#ff6a1f" />
          <stop offset="100%" stopColor="#b8410f" />
        </linearGradient>

        {/* Erases the right side of the disc so grain can take over. */}
        <linearGradient id={`${id}-fade`} x1="18" y1="32" x2="54" y2="32">
          <stop offset="0%" stopColor="#fff" stopOpacity="1" />
          <stop offset="52%" stopColor="#fff" stopOpacity="1" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </linearGradient>

        <mask id={`${id}-dissolve`}>
          <rect width={VB} height={VB} fill={`url(#${id}-fade)`} />
        </mask>
      </defs>

      {/* The disc, dissolving left to right */}
      <circle
        cx={CENTER}
        cy={CENTER}
        r={RADIUS}
        fill={`url(#${id}-disc)`}
        mask={simplified ? undefined : `url(#${id}-dissolve)`}
      />

      {/* Aperture notch: a single cut that makes the disc read as a lens
          rather than a generic circle. */}
      <path
        d={`M ${CENTER} ${CENTER - RADIUS} A ${RADIUS} ${RADIUS} 0 0 1 ${
          CENTER + RADIUS * 0.87
        } ${CENTER - RADIUS * 0.5} L ${CENTER} ${CENTER} Z`}
        fill="#08090a"
        fillOpacity="0.22"
        mask={simplified ? undefined : `url(#${id}-dissolve)`}
      />

      {!simplified &&
        DOTS.map((d, i) => (
          <circle
            key={i}
            cx={d.x}
            cy={d.y}
            r={d.r}
            fill="#ff6a1f"
            fillOpacity={d.o}
          />
        ))}
    </svg>
  );
}

export function Wordmark({
  size = 22,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-2.5 ${className ?? ""}`}
      style={{ fontSize: size }}
    >
      <Mark size={size * 1.35} />
      <span className="font-semibold tracking-[-0.02em] text-paper-100">
        Grain<span className="text-amber-400">room</span>
      </span>
    </span>
  );
}
