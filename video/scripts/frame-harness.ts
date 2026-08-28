/**
 * Shoots the still frames the video is cut from.
 *
 * Every frame is produced by the editor's own renderer against the editor's
 * own demo scene — the same code the site loads. Nothing here is a mockup, a
 * screenshot of a mockup, or a picture of a slider that does not move, which
 * matters for a video whose entire argument is that the thing works.
 */
import { GrainroomRenderer } from "../../src/lib/engine/renderer";
import { paintScene } from "../../src/lib/demoScene";
import { defaultParams, type LookParams } from "../../src/lib/looks";

const W = 1600;
const H = 1000;

type Shot = { id: string; params: Partial<LookParams> };

/**
 * The order is the argument the video makes: untouched, then a grade, then
 * the geometry work, then the painted work, then a finished print.
 */
export const SHOTS: Shot[] = [
  { id: "untouched", params: {} },
  {
    id: "safelight",
    params: {
      exposure: 0.12,
      contrast: 0.18,
      ambiance: 0.3,
      highlights: -0.28,
      shadows: 0.22,
      temperature: 0.22,
      fade: 0.18,
      grain: 0.34,
      halation: 0.3,
      vignette: 0.3,
      shadowHue: 0.6,
      shadowSat: 0.22,
      highlightHue: 0.08,
      highlightSat: 0.3,
      structure: 0.45,
      vibrance: 0.25,
      saturation: -0.12,
    },
  },
  {
    id: "framed",
    params: {
      exposure: 0.12,
      contrast: 0.2,
      ambiance: 0.3,
      temperature: 0.2,
      grain: 0.28,
      vignette: 0.28,
      cropX: 0.2,
      cropY: 0.08,
      cropW: 0.6,
      cropH: 0.84,
      straighten: 0.35,
    },
  },
  {
    id: "painted",
    params: {
      contrast: 0.16,
      ambiance: 0.28,
      temperature: 0.16,
      structure: 0.4,
      grain: 0.22,
      // Light held back off the sky, and the sun burned in a little.
      strokes: [
        { x: 0.68, y: 0.6, r: 0.16, amount: -0.75, mode: "light" as const },
        { x: 0.2, y: 0.78, r: 0.22, amount: 0.6, mode: "light" as const },
        { x: 0.5, y: 0.2, r: 0.3, amount: 0.5, mode: "saturation" as const },
      ],
      points: [
        {
          x: 0.68,
          y: 0.6,
          size: 0.22,
          brightness: -0.3,
          contrast: 0.35,
          saturation: 0.4,
        },
      ],
    },
  },
  {
    id: "print",
    params: {
      exposure: 0.1,
      contrast: 0.24,
      ambiance: 0.26,
      highlights: -0.3,
      shadows: 0.18,
      temperature: 0.18,
      fade: 0.14,
      grain: 0.3,
      halation: 0.26,
      bloom: 0.2,
      vignette: 0.32,
      structure: 0.4,
      vibrance: 0.22,
      borderWidth: 0.32,
      borderTone: 0.94,
      text: "SAFELIGHT · 05",
      textX: 0.5,
      textY: 0.93,
      textSize: 0.028,
      textTone: 0.1,
    },
  },
  // A phone holds a portrait frame. Showing a landscape print in a 9:16 cut
  // leaves two thirds of the screen empty, so the vertical edit gets its own
  // crop of the same photograph rather than a letterboxed version of the
  // wide one.
  {
    id: "tall-untouched",
    params: { cropX: 0.3, cropW: 0.42, cropY: 0, cropH: 1 },
  },
  {
    id: "tall-graded",
    params: {
      cropX: 0.3,
      cropW: 0.42,
      cropY: 0,
      cropH: 1,
      exposure: 0.12,
      contrast: 0.2,
      ambiance: 0.32,
      highlights: -0.28,
      shadows: 0.22,
      temperature: 0.24,
      fade: 0.16,
      grain: 0.32,
      halation: 0.32,
      vignette: 0.3,
      structure: 0.45,
      vibrance: 0.28,
      shadowHue: 0.6,
      shadowSat: 0.22,
      highlightHue: 0.08,
      highlightSat: 0.3,
    },
  },
  {
    id: "monochrome",
    params: {
      bw: true,
      bwMix: [0.7, 0.24, 0.06],
      contrast: 0.35,
      structure: 0.5,
      grain: 0.55,
      grainSeed: 42,
      fade: 0.12,
      vignette: 0.38,
      vignetteFalloff: 0.35,
      sharpen: 0.25,
    },
  },
];

let renderer: GrainroomRenderer | null = null;

/**
 * The pixel shape of every shot, before any are taken.
 *
 * A cropped frame is not the shape of the frame it was cropped from, and a
 * still delivered with black down both sides reads as a mistake rather than
 * as a crop. The capture window is sized per shot from this.
 */
export function sizes(): string {
  const longest = 1500;
  return JSON.stringify(
    SHOTS.map((shot) => {
      const p: LookParams = { ...defaultParams(), ...shot.params };
      const turned = p.quarterTurns % 2 === 1;
      const ow = turned ? H : W;
      const oh = turned ? W : H;
      const grow = 1 + p.expand * 0.5;
      const w = ow * p.cropW * grow;
      const h = oh * p.cropH * grow;
      const scale = longest / Math.max(w, h);
      return { id: shot.id, w: Math.round(w * scale), h: Math.round(h * scale) };
    })
  );
}

/** Draws one shot into a canvas that fills the window, ready to be captured. */
export function shoot(index: number): string {
  const canvas = document.getElementById("stage") as HTMLCanvasElement;
  if (!renderer) {
    renderer = new GrainroomRenderer(canvas);
    const scene = paintScene(W, H);
    renderer.setImage(scene, scene.width, scene.height);
  }

  const shot = SHOTS[index] ?? SHOTS[0];
  const params: LookParams = { ...defaultParams(), ...shot.params };

  // The page has already sized the canvas to fill the viewport, and the
  // capture window was sized to this shot's own shape, so rendering to the
  // element's measured box fills the frame edge to edge. Measuring the window
  // instead leaves a strip of dead space, because a headless window is not
  // quite the size it was asked for.
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.render(params, w * 2, h * 2);

  return shot.id;
}
