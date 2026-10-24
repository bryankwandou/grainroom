import type { LookParams } from "./looks";

/**
 * The tool catalogue.
 *
 * Names follow the vocabulary working photographers already use — Ambiance,
 * Structure, Tonal Contrast — because that language is the industry's, not
 * any one vendor's, and retyping it as something clever would only cost the
 * user their existing muscle memory.
 */

export type NumericKey = {
  [K in keyof LookParams]: LookParams[K] extends number ? K : never;
}[keyof LookParams];

export interface Slider {
  key: NumericKey;
  label: string;
  min: number;
  max: number;
  /** Value the slider snaps back to on double-tap. */
  neutral: number;
  step?: number;
  /** How the value reads out. Percent covers most, stops is exposure only. */
  format?: "percent" | "stops" | "raw" | "degrees" | "tilt";
  hint?: string;
}

export interface Tool {
  id: string;
  name: string;
  group: ToolGroup;
  blurb: string;
  sliders: Slider[];
}

export type ToolGroup = "tune" | "detail" | "creative" | "geometry" | "portrait";

export const GROUP_LABELS: Record<ToolGroup, string> = {
  tune: "Tune",
  detail: "Detail",
  creative: "Looks",
  geometry: "Frame",
  portrait: "Portrait",
};

const pct = (
  key: NumericKey,
  label: string,
  hint?: string,
  range: [number, number] = [-1, 1]
): Slider => ({
  key,
  label,
  min: range[0],
  max: range[1],
  neutral: range[0] === 0 ? 0 : 0,
  step: 0.01,
  format: "percent",
  hint,
});

export const TOOLS: Tool[] = [
  {
    id: "tune",
    name: "Tune Image",
    group: "tune",
    blurb: "Overall brightness, contrast and colour weight.",
    sliders: [
      {
        key: "exposure",
        label: "Exposure",
        min: -2,
        max: 2,
        neutral: 0,
        step: 0.01,
        format: "stops",
        hint: "Measured in stops, the way a camera meters it.",
      },
      pct("contrast", "Contrast"),
      pct("ambiance", "Ambiance", "Lifts midtones and colour together. Start here."),
      pct("highlights", "Highlights", "Negative recovers detail from blown areas."),
      pct("shadows", "Shadows", "Positive opens up the dark end."),
      pct("whites", "Whites"),
      pct("blacks", "Blacks"),
      pct("saturation", "Saturation"),
      pct("vibrance", "Vibrance", "Protects skin and already-vivid colour."),
    ],
  },
  {
    id: "white-balance",
    name: "White Balance",
    group: "tune",
    blurb: "Correct a colour cast, or lean into one.",
    sliders: [
      pct("temperature", "Temperature", "Cool to warm."),
      pct("tint", "Tint", "Magenta to green."),
    ],
  },
  {
    id: "curves",
    name: "Curves",
    group: "tune",
    blurb: "Direct control over the tone response, per channel.",
    sliders: [],
  },
  {
    id: "hsl",
    name: "Colour HSL",
    group: "tune",
    blurb: "Move one colour without disturbing its neighbours.",
    sliders: [],
  },
  {
    id: "selective",
    name: "Selective",
    group: "tune",
    blurb: "Drop a point on one part of the photo and adjust only that part.",
    sliders: [],
  },
  {
    id: "brush",
    name: "Brush",
    group: "tune",
    blurb: "Paint light or colour into one part of the frame by hand.",
    sliders: [],
  },
  {
    id: "healing",
    name: "Healing",
    group: "detail",
    blurb: "Fill a blemish in from the ring of pixels around it.",
    sliders: [],
  },
  {
    id: "details",
    name: "Details",
    group: "detail",
    blurb: "Local contrast and edge definition.",
    sliders: [
      pct("structure", "Structure", "Local contrast. Texture without halos."),
      pct("sharpen", "Sharpening", undefined, [0, 1]),
    ],
  },
  {
    id: "dehaze",
    name: "Dehaze",
    group: "detail",
    blurb: "Cut atmospheric flatness out of distant subjects.",
    sliders: [pct("dehaze", "Strength", undefined, [0, 1])],
  },
  {
    id: "lens-blur",
    name: "Lens Blur",
    group: "detail",
    blurb: "Soften the frame the way a wide aperture would.",
    sliders: [
      pct("lensBlur", "Amount", undefined, [0, 1]),
      pct("blurRadius", "Radius", undefined, [0, 1]),
    ],
  },
  {
    id: "tonality",
    name: "Tonality",
    group: "creative",
    blurb: "The matte, faded response of a darkroom print.",
    sliders: [
      pct("fade", "Fade", "Raises the black point.", [0, 1]),
      pct("vignette", "Vignette"),
      pct("vignetteFalloff", "Falloff", "Where the darkening begins.", [0, 1]),
    ],
  },
  {
    id: "grain",
    name: "Grain",
    group: "creative",
    blurb: "Film grain, weighted toward the midtones like the real thing.",
    sliders: [
      pct("grain", "Amount", undefined, [0, 1]),
      {
        key: "grainSeed",
        label: "Pattern",
        min: 1,
        max: 200,
        neutral: 1,
        step: 1,
        format: "raw",
        hint: "Reshuffles the grain without changing its density.",
      },
    ],
  },
  {
    id: "glow",
    name: "Glow",
    group: "creative",
    blurb: "How highlights bleed. Bloom is neutral, halation is film.",
    sliders: [
      pct("bloom", "Bloom", undefined, [0, 1]),
      pct("halation", "Halation", "The red ring film leaves around hot highlights.", [
        0, 1,
      ]),
    ],
  },
  {
    id: "split-tone",
    name: "Split Tone",
    group: "creative",
    blurb: "Different colour in the shadows than in the highlights.",
    sliders: [
      {
        key: "shadowHue",
        label: "Shadow hue",
        min: 0,
        max: 1,
        neutral: 0.58,
        step: 0.005,
        format: "degrees",
      },
      pct("shadowSat", "Shadow strength", undefined, [0, 1]),
      {
        key: "highlightHue",
        label: "Highlight hue",
        min: 0,
        max: 1,
        neutral: 0.09,
        step: 0.005,
        format: "degrees",
      },
      pct("highlightSat", "Highlight strength", undefined, [0, 1]),
    ],
  },
  {
    id: "crop",
    name: "Crop & Rotate",
    group: "geometry",
    blurb: "Reframe, straighten a horizon, turn or mirror the photo.",
    sliders: [
      {
        key: "straighten",
        label: "Straighten",
        min: -1,
        max: 1,
        neutral: 0,
        step: 0.002,
        format: "tilt",
        hint: "The frame zooms in just enough to keep the corners filled.",
      },
    ],
  },
  {
    id: "cut-out",
    name: "Cut Out",
    group: "portrait",
    blurb: "Separate the subject from the background, and treat them apart.",
    sliders: [
      pct("cutoutAmount", "Strength", "How far the background is pushed back.", [0, 1]),
      pct("cutoutFeather", "Edge", "A softer edge for hair and fur; a harder one for glass and metal.", [0, 1]),
    ],
  },
  {
    id: "double-exposure",
    name: "Double Exposure",
    group: "creative",
    blurb: "Lay a second photograph over the first, the way two negatives do.",
    sliders: [
      pct("blendOpacity", "Strength", "How much of the second frame comes through.", [0, 1]),
      {
        key: "blendScale",
        label: "Size",
        min: 0.25,
        max: 2,
        neutral: 1,
        step: 0.01,
        format: "percent",
      },
      {
        key: "blendX",
        label: "Across",
        min: 0,
        max: 1,
        neutral: 0.5,
        step: 0.005,
        format: "percent",
      },
      {
        key: "blendY",
        label: "Down",
        min: 0,
        max: 1,
        neutral: 0.5,
        step: 0.005,
        format: "percent",
      },
    ],
  },
  {
    id: "text",
    name: "Text",
    group: "creative",
    blurb: "A caption, drawn into the frame at export resolution.",
    sliders: [
      {
        key: "textSize",
        label: "Size",
        min: 0.02,
        max: 0.3,
        neutral: 0.06,
        step: 0.002,
        format: "percent",
      },
      {
        key: "textX",
        label: "Across",
        min: 0,
        max: 1,
        neutral: 0.5,
        step: 0.005,
        format: "percent",
      },
      {
        key: "textY",
        label: "Down",
        min: 0,
        max: 1,
        neutral: 0.88,
        step: 0.005,
        format: "percent",
      },
      {
        key: "textTone",
        label: "Tone",
        min: 0,
        max: 1,
        neutral: 1,
        step: 0.01,
        format: "percent",
        hint: "Type carries a shadow the opposite way, so it stays readable.",
      },
      {
        key: "textOpacity",
        label: "Opacity",
        min: 0,
        max: 1,
        neutral: 1,
        step: 0.01,
        format: "percent",
      },
    ],
  },
  {
    id: "expand",
    name: "Expand",
    group: "geometry",
    blurb: "Open the frame past the edge of the photo and fill what is outside.",
    sliders: [
      pct(
        "expand",
        "Amount",
        "The border is the edge of the picture reflected back in.",
        [0, 1]
      ),
    ],
  },
  {
    id: "portrait",
    name: "Portrait",
    group: "portrait",
    blurb: "Skin, eyes and a lift in the middle of the frame.",
    sliders: [
      pct("skinSmooth", "Skin smoothing", "Held to skin tones, not the whole frame.", [0, 1]),
      pct("eyeClarity", "Eye clarity", "Sharpens the dark detail skin does not have.", [0, 1]),
      pct("faceSpotlight", "Spotlight", "Lifts the centre and settles the corners.", [0, 1]),
    ],
  },
  {
    id: "frames",
    name: "Frames",
    group: "geometry",
    blurb: "A printed border, masked into the frame the way an easel does it.",
    sliders: [
      pct("borderWidth", "Width", undefined, [0, 1]),
      {
        key: "borderTone",
        label: "Tone",
        min: 0,
        max: 1,
        // Paper white is where this starts, so that is where "unchanged" is.
        neutral: 1,
        step: 0.01,
        format: "percent",
        hint: "Black at the bottom, paper white at the top.",
      },
    ],
  },
  {
    id: "perspective",
    name: "Perspective",
    group: "geometry",
    blurb: "Stand up a building that leans because the camera was tilted.",
    sliders: [
      pct("perspectiveV", "Tilt", "Verticals that converge upward or down."),
      pct("perspectiveH", "Skew", "The same correction across the frame."),
    ],
  },
  {
    id: "black-white",
    name: "Black & White",
    group: "creative",
    blurb: "A channel mixer, so you can dodge by colour the way a filter does.",
    sliders: [],
  },
];

export const TOOLS_BY_ID = new Map(TOOLS.map((t) => [t.id, t]));

/**
 * What is left.
 *
 * Nothing, as of the release that added Cut Out and RAW develop. The list is
 * kept rather than deleted: the next thing that cannot be built yet belongs
 * here, in the interface, rather than in a private backlog. A roadmap nobody
 * can see is a marketing document.
 */
export const ROADMAP_TOOLS: { name: string; group: ToolGroup; note: string }[] = [
];

/* ------------------------------------------------------------------ */

export function formatValue(slider: Slider, value: number): string {
  switch (slider.format) {
    case "stops":
      return `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
    case "degrees":
      return `${Math.round(value * 360)}°`;
    // Straighten runs -1..1 over fifteen degrees each way; showing the raw
    // fraction would mean nothing to anyone levelling a horizon.
    case "tilt":
      return `${value > 0 ? "+" : ""}${(value * 15).toFixed(1)}°`;
    case "raw":
      return String(Math.round(value));
    default: {
      const n = Math.round(value * 100);
      return `${n > 0 ? "+" : ""}${n}`;
    }
  }
}

/** Sliders the user has actually moved, for the stack summary. */
export function activeSliders(
  tool: Tool,
  params: LookParams
): { slider: Slider; value: number }[] {
  return tool.sliders
    .map((slider) => ({ slider, value: params[slider.key] as number }))
    .filter(({ slider, value }) => Math.abs(value - slider.neutral) > 0.001);
}
