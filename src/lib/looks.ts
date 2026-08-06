/**
 * A Look is the whole product in one object.
 *
 * It is a deterministic recipe: the same Look applied to the same pixels
 * produces the same image on any machine, forever. That property is what
 * makes it worth addressing by content hash and worth anchoring on a ledger.
 * The photo never leaves the device; only the recipe travels.
 */

export interface LookParams {
  // Tune Image
  exposure: number;      // stops, -2 .. 2
  contrast: number;      // -1 .. 1
  highlights: number;    // -1 .. 1
  shadows: number;       // -1 .. 1
  whites: number;        // -1 .. 1
  blacks: number;        // -1 .. 1
  ambiance: number;      // -1 .. 1
  saturation: number;    // -1 .. 1
  vibrance: number;      // -1 .. 1

  // White Balance
  temperature: number;   // -1 .. 1
  tint: number;          // -1 .. 1

  // Details
  structure: number;     // -1 .. 1
  sharpen: number;       // 0 .. 1

  // Tonality / film
  fade: number;          // 0 .. 1
  grain: number;         // 0 .. 1
  grainSeed: number;
  vignette: number;      // -1 .. 1
  vignetteFalloff: number; // 0 .. 1

  // Glow & atmosphere
  bloom: number;         // 0 .. 1
  halation: number;      // 0 .. 1
  dehaze: number;        // 0 .. 1
  lensBlur: number;      // 0 .. 1
  blurRadius: number;    // 0 .. 1

  // Split tone
  shadowHue: number;     // 0 .. 1
  shadowSat: number;     // 0 .. 1
  highlightHue: number;  // 0 .. 1
  highlightSat: number;  // 0 .. 1

  // Black & white channel mixer
  bw: boolean;
  bwMix: [number, number, number];

  // Targeted HSL, 8 bands: red orange yellow green aqua blue purple magenta
  hueShift: number[];
  satShift: number[];
  lumShift: number[];

  // Curves, control points in 0..1 space
  curveRGB: CurvePoint[];
  curveR: CurvePoint[];
  curveG: CurvePoint[];
  curveB: CurvePoint[];
}

export interface CurvePoint {
  x: number;
  y: number;
}

export const HSL_BANDS = [
  "Red",
  "Orange",
  "Yellow",
  "Green",
  "Aqua",
  "Blue",
  "Purple",
  "Magenta",
] as const;

const LINEAR_CURVE: CurvePoint[] = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
];

export function defaultParams(): LookParams {
  return {
    exposure: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
    ambiance: 0,
    saturation: 0,
    vibrance: 0,
    temperature: 0,
    tint: 0,
    structure: 0,
    sharpen: 0,
    fade: 0,
    grain: 0,
    grainSeed: 1,
    vignette: 0,
    vignetteFalloff: 0.45,
    bloom: 0,
    halation: 0,
    dehaze: 0,
    lensBlur: 0,
    blurRadius: 0.4,
    shadowHue: 0.58,
    shadowSat: 0,
    highlightHue: 0.09,
    highlightSat: 0,
    bw: false,
    bwMix: [0.2126, 0.7152, 0.0722],
    hueShift: new Array(8).fill(0),
    satShift: new Array(8).fill(0),
    lumShift: new Array(8).fill(0),
    curveRGB: [...LINEAR_CURVE],
    curveR: [...LINEAR_CURVE],
    curveG: [...LINEAR_CURVE],
    curveB: [...LINEAR_CURVE],
  };
}

/* ------------------------------------------------------------------ */
/* Curve evaluation                                                    */
/* ------------------------------------------------------------------ */

/**
 * Monotone cubic interpolation (Fritsch-Carlson). Plain Catmull-Rom
 * overshoots on steep S-curves and produces halos in the highlights,
 * which is exactly where a curves tool must be trustworthy.
 */
export function evaluateCurve(points: CurvePoint[], x: number): number {
  const p = [...points].sort((a, b) => a.x - b.x);
  if (p.length === 0) return x;
  if (p.length === 1) return p[0].y;
  if (x <= p[0].x) return p[0].y;
  if (x >= p[p.length - 1].x) return p[p.length - 1].y;

  let i = 0;
  while (i < p.length - 2 && x > p[i + 1].x) i++;

  const h = p[i + 1].x - p[i].x;
  if (h <= 0) return p[i].y;

  // Secant slopes either side of each knot.
  const delta = (a: number, b: number) => (p[b].y - p[a].y) / (p[b].x - p[a].x);
  const d0 = i > 0 ? (delta(i - 1, i) + delta(i, i + 1)) / 2 : delta(i, i + 1);
  const d1 =
    i < p.length - 2 ? (delta(i, i + 1) + delta(i + 1, i + 2)) / 2 : delta(i, i + 1);

  const s = delta(i, i + 1);
  // Clamp tangents to keep the segment monotone.
  const m0 = s === 0 ? 0 : Math.max(-3 * s, Math.min(3 * s, d0));
  const m1 = s === 0 ? 0 : Math.max(-3 * s, Math.min(3 * s, d1));

  const t = (x - p[i].x) / h;
  const t2 = t * t;
  const t3 = t2 * t;

  return (
    (2 * t3 - 3 * t2 + 1) * p[i].y +
    (t3 - 2 * t2 + t) * h * m0 +
    (-2 * t3 + 3 * t2) * p[i + 1].y +
    (t3 - t2) * h * m1
  );
}

/** Bakes the four curves into one 256x1 RGBA texture the shader can sample. */
export function buildCurveLUT(params: LookParams): Uint8Array {
  const lut = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    lut[i * 4 + 0] = clamp255(evaluateCurve(params.curveR, x));
    lut[i * 4 + 1] = clamp255(evaluateCurve(params.curveG, x));
    lut[i * 4 + 2] = clamp255(evaluateCurve(params.curveB, x));
    lut[i * 4 + 3] = clamp255(evaluateCurve(params.curveRGB, x));
  }
  return lut;
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}

/* ------------------------------------------------------------------ */
/* Recipe envelope                                                     */
/* ------------------------------------------------------------------ */

export const LOOK_FORMAT = "grainroom.look/v1";

export interface LookRecipe {
  format: typeof LOOK_FORMAT;
  /** sha-256 of the canonical params. Stable across machines. */
  id: string;
  name: string;
  /** Wallet pubkey when the author chose to sign it. */
  author?: string;
  /** id of the Look this was forked from, forming the attribution chain. */
  parent?: string;
  createdAt: number;
  params: LookParams;
}

/**
 * Canonical JSON: keys sorted, floats fixed to 6 places. Two people who
 * arrive at visually identical settings must produce the same hash, so the
 * serialisation cannot depend on key insertion order or float formatting.
 */
export function canonicalise(params: LookParams): string {
  const round = (v: unknown): unknown => {
    if (typeof v === "number") return Number(v.toFixed(6));
    if (Array.isArray(v)) return v.map(round);
    if (v && typeof v === "object") {
      const src = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(src).sort()) out[k] = round(src[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(round(params));
}

export async function hashParams(params: LookParams): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalise(params));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function createLook(
  name: string,
  params: LookParams,
  opts: { author?: string; parent?: string } = {}
): Promise<LookRecipe> {
  return {
    format: LOOK_FORMAT,
    id: await hashParams(params),
    name,
    author: opts.author,
    parent: opts.parent,
    createdAt: Date.now(),
    params: structuredClone(params),
  };
}

/** Compact, URL-safe encoding so a Look fits in a link or a QR code. */
export function encodeLook(look: LookRecipe): string {
  const json = JSON.stringify(look);
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeLook(encoded: string): LookRecipe {
  const b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const look = JSON.parse(new TextDecoder().decode(bytes)) as LookRecipe;
  if (look.format !== LOOK_FORMAT) {
    throw new Error(`Unsupported Look format: ${look.format}`);
  }
  // Fill in anything a newer default added, so old Looks keep opening.
  look.params = { ...defaultParams(), ...look.params };
  return look;
}

/** True when the Look would leave the image untouched. */
export function isNeutral(params: LookParams): boolean {
  return canonicalise(params) === canonicalise(defaultParams());
}
