"use client";

import { useEffect, useRef, useState } from "react";
import { GrainroomRenderer } from "@/lib/engine/renderer";
import { defaultParams, type LookParams } from "@/lib/looks";
import { paintScene } from "@/lib/demoScene";

/**
 * The landing hero runs the real pipeline.
 *
 * Rather than showing a screenshot, this mounts the same GrainroomRenderer
 * the editor uses and drives it against a scene painted at runtime. Nothing
 * about the demo is faked, so if the shaders regress the front page breaks
 * with them — which is the point.
 */

interface Preset {
  name: string;
  note: string;
  params: Partial<LookParams>;
}

const PRESETS: Preset[] = [
  {
    name: "Untouched",
    note: "Straight out of camera",
    params: {},
  },
  {
    name: "Safelight",
    note: "Warm split tone, lifted blacks, fine grain",
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
      structure: 0.25,
    },
  },
  {
    name: "Cold Open",
    note: "Cool shadows, hard contrast, dehazed",
    params: {
      exposure: -0.1,
      contrast: 0.42,
      blacks: 0.3,
      whites: 0.18,
      temperature: -0.3,
      tint: -0.08,
      dehaze: 0.42,
      structure: 0.45,
      vibrance: 0.25,
      saturation: -0.12,
      vignette: 0.22,
      shadowHue: 0.58,
      shadowSat: 0.3,
    },
  },
  {
    name: "Fibre Print",
    note: "Red-filter black and white, heavy grain",
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
  {
    name: "Bloomlight",
    note: "Soft highlight bleed, glowing midtones",
    params: {
      exposure: 0.25,
      contrast: -0.08,
      ambiance: 0.4,
      bloom: 0.45,
      halation: 0.18,
      lensBlur: 0.12,
      blurRadius: 0.55,
      fade: 0.28,
      vibrance: 0.35,
      temperature: 0.14,
      highlights: -0.2,
    },
  },
];


/** Eases between two parameter sets so preset changes read as a develop, not a cut. */
function lerpParams(a: LookParams, b: LookParams, t: number): LookParams {
  const out = { ...a };
  (Object.keys(a) as (keyof LookParams)[]).forEach((k) => {
    const av = a[k];
    const bv = b[k];
    if (typeof av === "number" && typeof bv === "number") {
      (out[k] as number) = av + (bv - av) * t;
    } else if (Array.isArray(av) && Array.isArray(bv) && av.length === bv.length) {
      // Only the numeric arrays interpolate. Curve control points are pairs,
      // and crossfading them would drag the knots through nonsense positions.
      if (av.every((v) => typeof v === "number")) {
        (out[k] as number[]) = (av as number[]).map(
          (v, i) => v + ((bv[i] as number) - v) * t
        );
      } else {
        (out[k] as unknown) = t > 0.5 ? bv : av;
      }
    } else {
      (out[k] as unknown) = t > 0.5 ? bv : av;
    }
  });
  return out;
}

export default function HeroDemo() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<GrainroomRenderer | null>(null);
  const rafRef = useRef<number | null>(null);

  const [index, setIndex] = useState(1);
  const [failed, setFailed] = useState(false);

  // Animation bookkeeping lives in refs; re-rendering React at 60fps would
  // be pure waste when only the GPU state actually changes.
  const fromRef = useRef<LookParams>(defaultParams());
  const toRef = useRef<LookParams>(defaultParams());
  const startRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let renderer: GrainroomRenderer;
    try {
      renderer = new GrainroomRenderer(canvas);
    } catch {
      setFailed(true);
      return;
    }
    rendererRef.current = renderer;

    const scene = paintScene(1600, 1000);
    renderer.setImage(scene, scene.width, scene.height);

    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const DURATION = prefersReduced ? 0 : 900;

    const tick = (now: number) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssW = wrap.clientWidth;
      const cssH = wrap.clientHeight;
      if (cssW > 0 && cssH > 0) {
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;

        const elapsed = now - startRef.current;
        const raw = DURATION === 0 ? 1 : Math.min(1, elapsed / DURATION);
        // Same curve the CSS transitions use, so the page feels of a piece.
        const t = 1 - Math.pow(1 - raw, 3);
        const params = lerpParams(fromRef.current, toRef.current, t);
        renderer.render(params, cssW * dpr, cssH * dpr);
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    // Seed the first transition: untouched, then resolving into Safelight.
    fromRef.current = defaultParams();
    toRef.current = { ...defaultParams(), ...PRESETS[1].params };
    startRef.current = performance.now();
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  const selectPreset = (i: number) => {
    // Freeze the current interpolated state as the new starting point so a
    // mid-transition click does not snap.
    const now = performance.now();
    const elapsed = now - startRef.current;
    const raw = Math.min(1, elapsed / 900);
    const t = 1 - Math.pow(1 - raw, 3);
    fromRef.current = lerpParams(fromRef.current, toRef.current, t);
    toRef.current = { ...defaultParams(), ...PRESETS[i].params };
    startRef.current = now;
    setIndex(i);
  };

  // Cycle on its own until someone takes over.
  const [autoplay, setAutoplay] = useState(true);
  useEffect(() => {
    if (!autoplay || failed) return;
    const id = window.setInterval(() => {
      setIndex((i) => {
        const next = i >= PRESETS.length - 1 ? 1 : i + 1;
        selectPreset(next);
        return next;
      });
    }, 3800);
    return () => window.clearInterval(id);
  }, [autoplay, failed]);

  if (failed) {
    return (
      <div className="flex aspect-[16/10] w-full items-center justify-center rounded-lg border border-ink-700 bg-ink-800 p-8 text-center">
        <p className="text-sm text-paper-400">
          This browser does not expose WebGL2, which Grainroom needs in order to
          process anything. Chrome, Edge, Firefox and Safari 15 or newer all
          support it.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div
        ref={wrapRef}
        className="grain-overlay relative aspect-[16/10] w-full overflow-hidden rounded-lg border border-ink-700 bg-ink-800"
      >
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

        <div className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-ink-600/70 bg-ink-900/80 px-2.5 py-1.5 backdrop-blur">
          <p className="text-[11px] font-medium text-paper-100">
            {PRESETS[index].name}
          </p>
          <p className="text-[10px] text-paper-400">{PRESETS[index].note}</p>
        </div>

        <div className="pointer-events-none absolute right-3 top-3 rounded-full border border-fixer-400/30 bg-ink-900/80 px-2.5 py-1 backdrop-blur">
          <span className="text-[10px] text-fixer-400">Live · WebGL2</span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {PRESETS.map((p, i) => (
          <button
            key={p.name}
            onClick={() => {
              setAutoplay(false);
              selectPreset(i);
            }}
            className={`focus-ring rounded-md border px-2.5 py-1.5 text-[11px] transition ${
              index === i
                ? "border-amber-500/70 bg-amber-500/10 text-amber-200"
                : "border-ink-600 text-paper-400 hover:border-ink-500 hover:text-paper-200"
            }`}
          >
            {p.name}
          </button>
        ))}
      </div>

      <p className="mt-2.5 text-[11px] leading-relaxed text-paper-400/80">
        Not a screenshot. The scene above is painted in the browser and pushed
        through the same four-pass pipeline the editor uses — tone and colour,
        two blur passes, then structure, glow and grain.
      </p>
    </div>
  );
}
