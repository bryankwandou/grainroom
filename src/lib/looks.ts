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

  // Framing. The crop rect lives in the oriented image, so turning a photo
  // does not silently move the crop somewhere else.
  cropX: number;         // 0 .. 1
  cropY: number;         // 0 .. 1
  cropW: number;         // 0 .. 1
  cropH: number;         // 0 .. 1
  quarterTurns: number;  // 0 .. 3, clockwise
  straighten: number;    // -1 .. 1, maps to +/- 15 degrees
  flipH: boolean;
  flipV: boolean;

  // Expand. Grows the frame past the edge of the photo and fills what is
  // outside by reflecting the border back in.
  expand: number;        // 0 .. 1, up to half again as wide

  // Perspective. Keystone correction for the leaning-building problem, one
  // axis each. The frame zooms in to stay filled rather than showing wedges.
  perspectiveH: number;  // -1 .. 1
  perspectiveV: number;  // -1 .. 1

  // Portrait. Gated on skin tone rather than on a detected face: no model
  // ships with the app, and a tone gate is honest about what it can do.
  skinSmooth: number;    // 0 .. 1
  faceSpotlight: number; // 0 .. 1
  eyeClarity: number;    // 0 .. 1

  // Print border. Laid over the frame rather than added around it, the way a
  // darkroom easel masks the edges of the paper.
  borderWidth: number;   // 0 .. 1, up to a tenth of the short edge
  borderTone: number;    // 0 black .. 1 white

  // Selective control points, anchored to the photo rather than to the frame
  points: SelectivePoint[];

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

/**
 * One selective adjustment.
 *
 * The position is in source-image coordinates, not frame coordinates, so
 * cropping or turning the photo afterwards leaves the point on the same
 * eyebrow or the same patch of sky it was put on.
 */
export interface SelectivePoint {
  x: number;          // 0 .. 1 across the source
  y: number;          // 0 .. 1 down the source
  size: number;       // radius as a fraction of the frame
  brightness: number; // -1 .. 1
  contrast: number;   // -1 .. 1
  saturation: number; // -1 .. 1
}

/** The shader carries this many; more would cost a uniform array resize. */
export const MAX_SELECTIVE_POINTS = 6;

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
    cropX: 0,
    cropY: 0,
    cropW: 1,
    cropH: 1,
    quarterTurns: 0,
    straighten: 0,
    flipH: false,
    flipV: false,
    expand: 0,
    perspectiveH: 0,
    perspectiveV: 0,
    skinSmooth: 0,
    faceSpotlight: 0,
    eyeClarity: 0,
    borderWidth: 0,
    borderTone: 1,
    points: [],
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
  // TextEncoder yields Uint8Array<ArrayBufferLike>, which recent @types/node
  // no longer treats as a BufferSource even though it always is one at runtime.
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
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

/* ------------------------------------------------------------------ */
/* Framing                                                             */
/* ------------------------------------------------------------------ */

/** Straighten runs to fifteen degrees each way, which covers a bad horizon. */
export const MAX_STRAIGHTEN_RAD = (15 * Math.PI) / 180;

/**
 * Pixel size of the finished frame.
 *
 * Crop and rotation change the shape of the output, so this is what the
 * canvas has to be fitted to and what an export at full quality should
 * produce. Rounding up by half a pixel would show as a transparent hairline
 * on one edge, so the result is floored and never allowed below one pixel.
 */
export function framedSize(
  params: LookParams,
  sourceW: number,
  sourceH: number
): { w: number; h: number } {
  const turned = params.quarterTurns % 2 === 1;
  const orientedW = turned ? sourceH : sourceW;
  const orientedH = turned ? sourceW : sourceH;
  const grow = expandFactor(params);
  return {
    w: Math.max(1, Math.floor(orientedW * params.cropW * grow)),
    h: Math.max(1, Math.floor(orientedH * params.cropH * grow)),
  };
}

/** How much larger than the crop the finished frame is. 1 means no expansion. */
export function expandFactor(params: LookParams): number {
  return 1 + params.expand * 0.5;
}

/** Common framing ratios, plus the two that depend on the photo in hand. */
export const CROP_RATIOS: { label: string; ratio: number | null }[] = [
  { label: "Free", ratio: null },
  { label: "Original", ratio: 0 },
  { label: "1:1", ratio: 1 },
  { label: "4:5", ratio: 4 / 5 },
  { label: "5:4", ratio: 5 / 4 },
  { label: "3:2", ratio: 3 / 2 },
  { label: "2:3", ratio: 2 / 3 },
  { label: "16:9", ratio: 16 / 9 },
  { label: "9:16", ratio: 9 / 16 },
];

/**
 * Largest crop of the requested ratio that fits, centred on what is already
 * framed. Snapping to the centre rather than a corner keeps the subject in
 * roughly the same place when someone tries several ratios in a row.
 */
export function fitCropToRatio(
  params: LookParams,
  ratio: number,
  sourceW: number,
  sourceH: number
): Pick<LookParams, "cropX" | "cropY" | "cropW" | "cropH"> {
  const turned = params.quarterTurns % 2 === 1;
  const orientedW = turned ? sourceH : sourceW;
  const orientedH = turned ? sourceW : sourceH;

  // Work in pixels: a ratio means nothing in the normalised space alone.
  let w = orientedW;
  let h = w / ratio;
  if (h > orientedH) {
    h = orientedH;
    w = h * ratio;
  }

  const cw = w / orientedW;
  const ch = h / orientedH;
  const cx = params.cropX + params.cropW / 2;
  const cy = params.cropY + params.cropH / 2;

  return {
    cropW: cw,
    cropH: ch,
    cropX: Math.min(Math.max(cx - cw / 2, 0), 1 - cw),
    cropY: Math.min(Math.max(cy - ch / 2, 0), 1 - ch),
  };
}

/**
 * Frame coordinates to source coordinates, both 0..1.
 *
 * This is the same walk the shader's sourceUV() makes, kept in step with it
 * by hand. It exists so that tapping the canvas can land a selective point on
 * the pixel under the finger even when the photo is cropped, turned,
 * straightened or keystoned — the tap is in frame space, the point is stored
 * in source space, and only this function knows how to cross between them.
 */
export function frameToSource(
  p: LookParams,
  uv: { x: number; y: number },
  sourceW: number,
  sourceH: number
): { x: number; y: number } {
  const turned = p.quarterTurns % 2 === 1;
  const orientedW = turned ? sourceH : sourceW;
  const orientedH = turned ? sourceW : sourceH;

  // Expansion grows outward from the middle of the crop, not the middle of
  // the photo, or moving the crop would drag the new border around with it.
  const grow = expandFactor(p);
  const cx = p.cropX + p.cropW / 2;
  const cy = p.cropY + p.cropH / 2;
  let x = (cx + (uv.x - 0.5) * p.cropW * grow - 0.5) * orientedW;
  let y = (cy + (uv.y - 0.5) * p.cropH * grow - 0.5) * orientedH;

  const turns = ((p.quarterTurns % 4) + 4) % 4;
  if (turns === 3) [x, y] = [-y, x];
  else if (turns === 2) [x, y] = [-x, -y];
  else if (turns === 1) [x, y] = [y, -x];

  const angle = p.straighten * MAX_STRAIGHTEN_RAD;
  const ca = Math.abs(Math.cos(angle));
  const sa = Math.abs(Math.sin(angle));
  const zoom = Math.max(
    (sourceW * ca + sourceH * sa) / sourceW,
    (sourceW * sa + sourceH * ca) / sourceH
  );
  const c = Math.cos(-angle);
  const s = Math.sin(-angle);
  [x, y] = [(x * c - y * s) / zoom, (x * s + y * c) / zoom];

  const kx = p.perspectiveH * 0.5;
  const ky = p.perspectiveV * 0.5;
  if (Math.abs(kx) > 0.001 || Math.abs(ky) > 0.001) {
    let nx = (x / sourceW) * (1 - (Math.abs(kx) + Math.abs(ky)) * 0.5);
    let ny = (y / sourceH) * (1 - (Math.abs(kx) + Math.abs(ky)) * 0.5);
    const w = 1 + kx * nx + ky * ny;
    nx /= w;
    ny /= w;
    x = nx * sourceW;
    y = ny * sourceH;
  }

  return {
    x: (x / sourceW) * (p.flipH ? -1 : 1) + 0.5,
    y: (y / sourceH) * (p.flipV ? -1 : 1) + 0.5,
  };
}

/**
 * The other direction: where a point on the photo currently sits in the
 * frame. Used to draw the selective markers over the canvas. Values outside
 * 0..1 mean the point has been cropped out of view.
 */
export function sourceToFrame(
  p: LookParams,
  src: { x: number; y: number },
  sourceW: number,
  sourceH: number
): { x: number; y: number } {
  let nx = (src.x - 0.5) * (p.flipH ? -1 : 1);
  let ny = (src.y - 0.5) * (p.flipV ? -1 : 1);

  const kx = p.perspectiveH * 0.5;
  const ky = p.perspectiveV * 0.5;
  if (Math.abs(kx) > 0.001 || Math.abs(ky) > 0.001) {
    const w = 1 - (kx * nx + ky * ny);
    const scale = 1 - (Math.abs(kx) + Math.abs(ky)) * 0.5;
    nx = nx / w / scale;
    ny = ny / w / scale;
  }

  let x = nx * sourceW;
  let y = ny * sourceH;

  const angle = p.straighten * MAX_STRAIGHTEN_RAD;
  const ca = Math.abs(Math.cos(angle));
  const sa = Math.abs(Math.sin(angle));
  const zoom = Math.max(
    (sourceW * ca + sourceH * sa) / sourceW,
    (sourceW * sa + sourceH * ca) / sourceH
  );
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  x *= zoom;
  y *= zoom;
  [x, y] = [x * c - y * s, x * s + y * c];

  const turns = ((p.quarterTurns % 4) + 4) % 4;
  if (turns === 1) [x, y] = [-y, x];
  else if (turns === 2) [x, y] = [-x, -y];
  else if (turns === 3) [x, y] = [y, -x];

  const turned = turns % 2 === 1;
  const orientedW = turned ? sourceH : sourceW;
  const orientedH = turned ? sourceW : sourceH;

  const grow = expandFactor(p);
  const cx = p.cropX + p.cropW / 2;
  const cy = p.cropY + p.cropH / 2;
  return {
    x: (x / orientedW + 0.5 - cx) / (p.cropW * grow) + 0.5,
    y: (y / orientedH + 0.5 - cy) / (p.cropH * grow) + 0.5,
  };
}

/** True when the framing controls would leave the photo exactly as shot. */
export function isUnframed(p: LookParams): boolean {
  return (
    p.cropX === 0 &&
    p.cropY === 0 &&
    p.cropW === 1 &&
    p.cropH === 1 &&
    p.quarterTurns === 0 &&
    p.straighten === 0 &&
    !p.flipH &&
    !p.flipV &&
    p.perspectiveH === 0 &&
    p.perspectiveV === 0 &&
    p.expand === 0
  );
}
