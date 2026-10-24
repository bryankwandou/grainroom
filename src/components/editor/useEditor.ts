"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GrainroomRenderer } from "@/lib/engine/renderer";
import { developRaw, looksLikeRaw } from "@/lib/raw";
import {
  defaultParams,
  encodeLook,
  decodeLook,
  createLook,
  type LookParams,
  type LookRecipe,
} from "@/lib/looks";

interface HistoryEntry {
  params: LookParams;
  label: string;
  at: number;
}

export interface EditorState {
  params: LookParams;
  history: HistoryEntry[];
  cursor: number;
  imageName: string | null;
  imageSize: { w: number; h: number } | null;
  isReady: boolean;
  error: string | null;
}

/**
 * Owns the renderer, the parameter state and the undo stack.
 *
 * Renders are scheduled on animation frames rather than fired per input
 * event: a slider drag can emit far more events than the GPU needs to
 * redraw, and coalescing them is the difference between smooth and sticky.
 */
export function useEditor() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<GrainroomRenderer | null>(null);
  const frameRef = useRef<number | null>(null);
  const paramsRef = useRef<LookParams>(defaultParams());
  const showOriginalRef = useRef(false);

  const [params, setParamsState] = useState<LookParams>(defaultParams);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [cursor, setCursor] = useState(-1);
  const [imageName, setImageName] = useState<string | null>(null);
  const [imageSize, setImageSize] = useState<{ w: number; h: number } | null>(null);
  // Whether a second photograph has been chosen for a double exposure. It
  // lives on the renderer rather than in the Look: the Look says how to
  // combine two frames, the same way it never carried the first one either.
  const [hasBlendImage, setHasBlendImage] = useState(false);

  // The subject mask and how far along finding it is. The model runs here on
  // this machine; the photograph is not sent anywhere to be looked at.
  const [hasSubject, setHasSubject] = useState(false);
  const [subjectProgress, setSubjectProgress] = useState<string | null>(null);
  const sourceFileRef = useRef<File | null>(null);

  const [displaySize, setDisplaySize] = useState<{ w: number; h: number } | null>(
    null
  );
  const displayRef = useRef<{ w: number; h: number } | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ------------------------------------------------------------ */
  /* Rendering                                                     */
  /* ------------------------------------------------------------ */

  const draw = useCallback(() => {
    const r = rendererRef.current;
    const canvas = canvasRef.current;
    if (!r || !canvas || !r.isReady) return;

    const parent = canvas.parentElement;
    if (!parent) return;

    // Fit the image into the available box, capped at 2x DPR. Beyond that
    // the extra pixels cost real time on large photos and buy nothing.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const boxW = parent.clientWidth;
    const boxH = parent.clientHeight;
    if (boxW === 0 || boxH === 0) return;

    const active = showOriginalRef.current ? defaultParams() : paramsRef.current;

    // Fit the framed result, not the source: a cropped or turned photo has to
    // sit in a box its own shape, or the preview lies about what exports.
    const out = r.outputSize(active);
    const scale = Math.min(boxW / out.w, boxH / out.h);
    const cssW = Math.max(1, Math.floor(out.w * scale));
    const cssH = Math.max(1, Math.floor(out.h * scale));

    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;

    // Overlays (the selective markers) have to sit exactly on the picture, so
    // the display size is published. Guarded against re-render churn: this
    // runs on every animation frame and setState on an unchanged value would
    // otherwise keep the tree busy for no reason.
    const shown = displayRef.current;
    if (!shown || shown.w !== cssW || shown.h !== cssH) {
      displayRef.current = { w: cssW, h: cssH };
      setDisplaySize({ w: cssW, h: cssH });
    }

    r.render(active, cssW * dpr, cssH * dpr);
  }, []);

  const scheduleDraw = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      draw();
    });
  }, [draw]);

  const attachCanvas = useCallback(
    (node: HTMLCanvasElement | null) => {
      canvasRef.current = node;
      if (!node) return;
      if (rendererRef.current) return;
      try {
        rendererRef.current = new GrainroomRenderer(node);
      } catch (e) {
        setError(e instanceof Error ? e.message : "The GPU pipeline failed to start.");
      }
    },
    []
  );

  useEffect(() => {
    const onResize = () => scheduleDraw();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [scheduleDraw]);

  useEffect(() => {
    return () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, []);

  /* ------------------------------------------------------------ */
  /* Image loading                                                 */
  /* ------------------------------------------------------------ */

  const loadFile = useCallback(
    async (file: File) => {
      setError(null);
      const raw = looksLikeRaw(file);
      if (!raw && !file.type.startsWith("image/")) {
        setError("That file is not an image this browser can decode.");
        return;
      }
      try {
        let bitmap: ImageBitmap;
        if (raw) {
          // A RAW file is not a picture yet, so it goes through the decoder
          // before anything else can touch it. This runs here, in a worker on
          // this machine, and can take a few seconds on a large sensor.
          setSubjectProgress("Developing the RAW file…");
          const developed = await developRaw(file);
          bitmap = developed.bitmap;
          setSubjectProgress(null);
        } else {
          bitmap = await createImageBitmap(file, {
            // Honour the camera's orientation tag so portraits are not sideways.
            imageOrientation: "from-image",
          });
        }
        const r = rendererRef.current;
        if (!r) {
          setError("The renderer is not ready yet.");
          return;
        }
        r.setImage(bitmap, bitmap.width, bitmap.height);
        bitmap.close();

        sourceFileRef.current = file;
        // A different photograph means the old mask describes the wrong
        // subject, so it goes rather than quietly staying behind.
        r.clearCutoutMask();
        setHasSubject(false);
        setImageName(file.name);
        setImageSize({ w: r.width, h: r.height });
        setIsReady(true);
        // A new photo starts clean, but the Look in hand is kept — that is
        // how you apply one recipe across a set of frames.
        scheduleDraw();
      } catch (e) {
        setSubjectProgress(null);
        setError(
          raw
            ? "This RAW file could not be developed. Some very new camera models are not supported yet."
            : "This image could not be decoded. Try a JPEG or PNG."
        );
        void e;
      }
    },
    [scheduleDraw]
  );

  /* ------------------------------------------------------------ */
  /* Parameters and history                                        */
  /* ------------------------------------------------------------ */

  const applyParams = useCallback(
    (next: LookParams, options: { commit?: boolean; label?: string } = {}) => {
      paramsRef.current = next;
      setParamsState(next);
      scheduleDraw();

      if (options.commit) {
        setHistory((prev) => {
          const trimmed = prev.slice(0, cursorRef.current + 1);
          const entry: HistoryEntry = {
            params: structuredClone(next),
            label: options.label ?? "Adjustment",
            at: Date.now(),
          };
          const appended = [...trimmed, entry].slice(-60);
          cursorRef.current = appended.length - 1;
          setCursor(appended.length - 1);
          return appended;
        });
      }
    },
    [scheduleDraw]
  );

  // Kept in a ref so applyParams does not need cursor in its dependency list.
  const cursorRef = useRef(-1);
  useEffect(() => {
    cursorRef.current = cursor;
  }, [cursor]);

  const setParam = useCallback(
    (key: keyof LookParams, value: LookParams[keyof LookParams]) => {
      applyParams({ ...paramsRef.current, [key]: value });
    },
    [applyParams]
  );

  /**
   * Several keys at once, against the live parameters rather than whatever
   * the last render captured. Framing moves two or three values together and
   * a stale copy would drop whichever one changed a moment earlier.
   */
  const patchParams = useCallback(
    (
      patch: Partial<LookParams>,
      options: { commit?: boolean; label?: string } = {}
    ) => {
      applyParams({ ...paramsRef.current, ...patch }, options);
    },
    [applyParams]
  );

  /**
   * A patch computed from the live parameters. Painting appends to a list
   * many times a second, and reading that list from a render-scoped copy
   * would drop every dab laid down since the last paint.
   */
  const mutateParams = useCallback(
    (
      fn: (current: LookParams) => Partial<LookParams>,
      options: { commit?: boolean; label?: string } = {}
    ) => {
      applyParams({ ...paramsRef.current, ...fn(paramsRef.current) }, options);
    },
    [applyParams]
  );

  /** Hands a second photograph to the renderer for the double exposure. */
  const loadBlendFile = useCallback(async (file: File) => {
    const r = rendererRef.current;
    if (!r) return;
    const bitmap = await createImageBitmap(file);
    r.setBlendImage(bitmap);
    bitmap.close();
    setHasBlendImage(true);
  }, []);

  /**
   * Finds the subject, on this machine.
   *
   * The model is fetched once and cached by the browser; after that this
   * works with the network off. What never happens, at any point, is the
   * photograph being sent somewhere for a server to look at.
   */
  const findSubject = useCallback(async () => {
    const r = rendererRef.current;
    const file = sourceFileRef.current;
    if (!r || !file) return false;
    setSubjectProgress("Loading the model…");
    try {
      const { removeBackground } = await import("@imgly/background-removal");
      const cut = await removeBackground(file, {
        output: { format: "image/png", quality: 0.9 },
        progress: (key: string, current: number, total: number) => {
          const pct = total ? Math.round((current / total) * 100) : 0;
          setSubjectProgress(
            key.startsWith("fetch") ? `Loading the model… ${pct}%` : "Finding the subject…"
          );
        },
      });
      const bitmap = await createImageBitmap(cut);
      r.setCutoutMask(bitmap);
      bitmap.close();
      setHasSubject(true);
      setSubjectProgress(null);
      scheduleDraw();
      return true;
    } catch (e) {
      setSubjectProgress(null);
      setError(
        e instanceof Error && /fetch|network/i.test(e.message)
          ? "The subject model could not be downloaded. It is needed once, then Cut Out works offline."
          : "The subject could not be separated from this photograph."
      );
      return false;
    }
  }, [scheduleDraw]);

  const clearSubject = useCallback(() => {
    rendererRef.current?.clearCutoutMask();
    setHasSubject(false);
    scheduleDraw();
  }, [scheduleDraw]);

  const clearBlendImage = useCallback(() => {
    rendererRef.current?.clearBlendImage();
    setHasBlendImage(false);
  }, []);

  const commit = useCallback(
    (label: string) => {
      applyParams(paramsRef.current, { commit: true, label });
    },
    [applyParams]
  );

  const undo = useCallback(() => {
    setCursor((c) => {
      const next = Math.max(-1, c - 1);
      const target = next < 0 ? defaultParams() : history[next].params;
      paramsRef.current = structuredClone(target);
      setParamsState(paramsRef.current);
      cursorRef.current = next;
      scheduleDraw();
      return next;
    });
  }, [history, scheduleDraw]);

  const redo = useCallback(() => {
    setCursor((c) => {
      const next = Math.min(history.length - 1, c + 1);
      if (next < 0) return c;
      paramsRef.current = structuredClone(history[next].params);
      setParamsState(paramsRef.current);
      cursorRef.current = next;
      scheduleDraw();
      return next;
    });
  }, [history, scheduleDraw]);

  const reset = useCallback(() => {
    applyParams(defaultParams(), { commit: true, label: "Reverted to original" });
  }, [applyParams]);

  const setShowOriginal = useCallback(
    (show: boolean) => {
      showOriginalRef.current = show;
      scheduleDraw();
    },
    [scheduleDraw]
  );

  /* ------------------------------------------------------------ */
  /* Looks and export                                              */
  /* ------------------------------------------------------------ */

  const exportImage = useCallback(
    async (opts: { type?: string; quality?: number; maxEdge?: number } = {}) => {
      const r = rendererRef.current;
      if (!r || !r.isReady) throw new Error("Load a photo first.");
      const blob = await r.exportBlob(paramsRef.current, opts);
      // Put the preview back at screen resolution.
      scheduleDraw();
      return blob;
    },
    [scheduleDraw]
  );

  const saveLook = useCallback(
    async (name: string, opts: { author?: string; parent?: string } = {}) => {
      return createLook(name, paramsRef.current, opts);
    },
    []
  );

  const shareLook = useCallback(
    async (name: string) => {
      const look = await createLook(name, paramsRef.current);
      return { look, code: encodeLook(look) };
    },
    []
  );

  const loadLook = useCallback(
    (code: string) => {
      try {
        const look: LookRecipe = decodeLook(code.trim());
        applyParams(look.params, { commit: true, label: `Applied "${look.name}"` });
        return look;
      } catch (e) {
        setError(e instanceof Error ? e.message : "That Look code is not readable.");
        return null;
      }
    },
    [applyParams]
  );

  return {
    attachCanvas,
    params,
    setParam,
    patchParams,
    mutateParams,
    applyParams,
    commit,
    history,
    cursor,
    canUndo: cursor >= 0,
    canRedo: cursor < history.length - 1,
    undo,
    redo,
    reset,
    setShowOriginal,
    loadFile,
    exportImage,
    saveLook,
    shareLook,
    loadLook,
    imageName,
    imageSize,
    displaySize,
    hasBlendImage,
    loadBlendFile,
    clearBlendImage,
    hasSubject,
    subjectProgress,
    findSubject,
    clearSubject,
    isReady,
    error,
    clearError: () => setError(null),
  };
}
