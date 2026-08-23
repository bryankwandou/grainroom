"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Mark } from "@/components/Logo";
import { useEditor } from "./useEditor";
import { ChainPanel } from "./ChainPanel";
import {
  TOOLS,
  TOOLS_BY_ID,
  GROUP_LABELS,
  ROADMAP_TOOLS,
  formatValue,
  activeSliders,
  type Slider,
  type Tool,
  type ToolGroup,
} from "@/lib/tools";
import {
  HSL_BANDS,
  CROP_RATIOS,
  MAX_SELECTIVE_POINTS,
  fitCropToRatio,
  frameToSource,
  sourceToFrame,
  framedSize,
  isUnframed,
  type LookParams,
  type SelectivePoint,
} from "@/lib/looks";

/** The four things a selective point can do, in the order the drag cycles them. */
const POINT_CHANNELS: {
  key: keyof Pick<
    SelectivePoint,
    "brightness" | "contrast" | "saturation" | "size"
  >;
  label: string;
  min: number;
  max: number;
}[] = [
  { key: "brightness", label: "Brightness", min: -1, max: 1 },
  { key: "contrast", label: "Contrast", min: -1, max: 1 },
  { key: "saturation", label: "Saturation", min: -1, max: 1 },
  { key: "size", label: "Size", min: 0.05, max: 1 },
];

export default function Editor() {
  const ed = useEditor();
  const [activeToolId, setActiveToolId] = useState<string>("tune");
  const [sliderIndex, setSliderIndex] = useState(0);
  const [panel, setPanel] = useState<"tools" | "stack" | "chain" | "export">(
    "tools"
  );
  // The Look a shared link arrived from. Registering while this is set
  // records a derivative rather than a fresh claim, so the trail survives.
  const [parentId, setParentId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Selective: which point the controls and the canvas drag are aimed at,
  // and which of its four values that drag moves.
  const [activePoint, setActivePoint] = useState(0);
  const [pointChannel, setPointChannel] = useState(0);

  const tool = TOOLS_BY_ID.get(activeToolId) ?? TOOLS[0];
  const slider = tool.sliders[sliderIndex] ?? tool.sliders[0];
  const isSelective = activeToolId === "selective";

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2600);
  }, []);

  /* ---------------------------------------------------------- */
  /* Keyboard                                                    */
  /* ---------------------------------------------------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLElement &&
        ["INPUT", "TEXTAREA"].includes(e.target.tagName);
      if (typing) return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? ed.redo() : ed.undo();
      }
      // Hold to check the edit against the original, the way you would
      // lift a print out of the tray.
      if (e.key === "\\" && !e.repeat) ed.setShowOriginal(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "\\") ed.setShowOriginal(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [ed]);

  /* ---------------------------------------------------------- */
  /* Canvas drag: vertical picks the parameter, horizontal moves  */
  /* it. Lifted from how photographers already work one-handed.   */
  /* ---------------------------------------------------------- */

  const dragRef = useRef<{
    x: number;
    y: number;
    startValue: number;
    axis: "none" | "x" | "y";
    startIndex: number;
    mode: "slider" | "point";
  } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!ed.isReady) return;

    // Selective works the way it does in a darkroom: put a finger on the part
    // of the print you mean, then adjust. A tap either picks up a point that
    // is already there or leaves a new one where the finger landed.
    if (isSelective && ed.imageSize) {
      const rect = (e.target as HTMLElement).getBoundingClientRect();
      const uv = {
        x: (e.clientX - rect.left) / rect.width,
        y: (e.clientY - rect.top) / rect.height,
      };
      const near = nearestPoint(ed.params, uv, ed.imageSize);
      let index = near;
      if (near === -1) {
        if (ed.params.points.length >= MAX_SELECTIVE_POINTS) {
          notify(`Six points is the limit. Remove one to place another.`);
          return;
        }
        const src = frameToSource(ed.params, uv, ed.imageSize.w, ed.imageSize.h);
        const point: SelectivePoint = {
          x: clamp(src.x, 0, 1),
          y: clamp(src.y, 0, 1),
          size: 0.22,
          brightness: 0,
          contrast: 0,
          saturation: 0,
        };
        index = ed.params.points.length;
        ed.patchParams(
          { points: [...ed.params.points, point] },
          { commit: true, label: `Selective · point ${index + 1}` }
        );
      }
      setActivePoint(index);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      const current = ed.params.points[index];
      dragRef.current = {
        x: e.clientX,
        y: e.clientY,
        startValue: current ? current[POINT_CHANNELS[pointChannel].key] : 0,
        axis: "none",
        startIndex: pointChannel,
        mode: "point",
      };
      return;
    }

    if (!slider) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      x: e.clientX,
      y: e.clientY,
      startValue: ed.params[slider.key] as number,
      axis: "none",
      startIndex: sliderIndex,
      mode: "slider",
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;

    if (d.mode === "point") {
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (d.axis === "none") {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        d.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      }
      if (d.axis === "y") {
        const next = clampInt(
          d.startIndex + Math.round(dy / 46),
          0,
          POINT_CHANNELS.length - 1
        );
        if (next !== pointChannel) setPointChannel(next);
        return;
      }
      const ch = POINT_CHANNELS[pointChannel];
      const value = clamp(
        d.startValue + (dx / 380) * (ch.max - ch.min),
        ch.min,
        ch.max
      );
      updatePoint(activePoint, { [ch.key]: value }, false);
      return;
    }

    if (!slider) return;

    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;

    // Commit to an axis once past the slop threshold, then stay on it.
    if (d.axis === "none") {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      d.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }

    if (d.axis === "y") {
      const steps = Math.round(dy / 46);
      const next = clampInt(d.startIndex + steps, 0, tool.sliders.length - 1);
      if (next !== sliderIndex) setSliderIndex(next);
      return;
    }

    const range = slider.max - slider.min;
    // 380px of travel covers the full range, which keeps fine work possible
    // on a phone without making a full sweep feel like a chore.
    const next = clamp(d.startValue + (dx / 380) * range, slider.min, slider.max);
    ed.setParam(slider.key, next);
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d?.axis !== "x") return;
    if (d.mode === "point") {
      ed.commit(`Selective · ${POINT_CHANNELS[pointChannel].label}`);
    } else {
      ed.commit(`${tool.name} · ${slider?.label}`);
    }
  };

  /* ---------------------------------------------------------- */
  /* File handling                                               */
  /* ---------------------------------------------------------- */

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) ed.loadFile(file);
  };

  // A Look arriving in the address bar is applied once, then wiped from the
  // URL so a later reload does not undo whatever was done since.
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("look");
    if (!code) return;
    const look = ed.loadLook(code);
    if (look) {
      setParentId(look.id);
      notify(`Opened "${look.name}"`);
    }
    window.history.replaceState({}, "", window.location.pathname);
    // Deliberately mount-only: re-running would reapply the same recipe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // What the export will actually be, once crop and rotation are counted.
  const framed = useMemo(
    () =>
      ed.imageSize
        ? framedSize(ed.params, ed.imageSize.w, ed.imageSize.h)
        : null,
    [ed.imageSize, ed.params]
  );

  /**
   * Applies several framing keys at once. Dragging passes commit = false so a
   * sweep of a slider leaves one step in the history rather than two hundred.
   */
  const applyFraming = useCallback(
    (patch: Partial<LookParams>, label: string, commit = true) => {
      ed.patchParams(patch, { commit, label });
    },
    [ed]
  );

  /** Edits one selective point in place, leaving the rest untouched. */
  const updatePoint = useCallback(
    (index: number, patch: Partial<SelectivePoint>, commit = true) => {
      const points = ed.params.points.map((p, i) =>
        i === index ? { ...p, ...patch } : p
      );
      if (!points[index]) return;
      ed.patchParams(
        { points },
        { commit, label: `Selective · point ${index + 1}` }
      );
    },
    [ed]
  );

  const removePoint = useCallback(
    (index: number) => {
      ed.patchParams(
        { points: ed.params.points.filter((_, i) => i !== index) },
        { commit: true, label: "Selective · point removed" }
      );
      setActivePoint((a) => Math.max(0, a > index ? a - 1 : a));
    },
    [ed]
  );

  const grouped = useMemo(() => {
    const map = new Map<ToolGroup, Tool[]>();
    TOOLS.forEach((t) => {
      const list = map.get(t.group) ?? [];
      list.push(t);
      map.set(t.group, list);
    });
    return map;
  }, []);

  return (
    <div className="flex h-dvh flex-col bg-ink-900 text-paper-100">
      {/* ---------------- top bar ---------------- */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-ink-700 px-3 sm:px-4">
        <Link href="/" className="flex items-center gap-2 focus-ring rounded">
          <Mark size={26} />
          <span className="hidden text-sm font-semibold tracking-tight sm:inline">
            Grainroom
          </span>
        </Link>

        <div className="mx-2 h-5 w-px bg-ink-700" />

        <span className="truncate text-xs text-paper-400">
          {ed.imageName ?? "No photo loaded"}
          {ed.imageSize && (
            <span className="tabular ml-2 text-paper-400/70">
              {ed.imageSize.w}×{ed.imageSize.h}
              {framed &&
                (framed.w !== ed.imageSize.w || framed.h !== ed.imageSize.h) && (
                  <span className="ml-1.5 text-amber-400/80">
                    → {framed.w}×{framed.h}
                  </span>
                )}
            </span>
          )}
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          <IconButton
            label="Undo"
            disabled={!ed.canUndo}
            onClick={ed.undo}
            shortcut="Ctrl+Z"
          >
            <path d="M3 7h9a5 5 0 0 1 0 10H7" />
            <path d="m3 7 4-4M3 7l4 4" />
          </IconButton>
          <IconButton
            label="Redo"
            disabled={!ed.canRedo}
            onClick={ed.redo}
            shortcut="Ctrl+Shift+Z"
          >
            <path d="M17 7H8a5 5 0 0 0 0 10h5" />
            <path d="m17 7-4-4M17 7l-4 4" />
          </IconButton>

          <button
            onPointerDown={() => ed.setShowOriginal(true)}
            onPointerUp={() => ed.setShowOriginal(false)}
            onPointerLeave={() => ed.setShowOriginal(false)}
            disabled={!ed.isReady}
            className="focus-ring rounded-md border border-ink-600 px-2.5 py-1.5 text-xs text-paper-300 transition hover:border-ink-500 hover:text-paper-100 disabled:opacity-35"
            title="Hold to see the original (\\)"
          >
            Compare
          </button>

          <button
            onClick={() => fileInputRef.current?.click()}
            className="focus-ring rounded-md border border-ink-600 px-2.5 py-1.5 text-xs text-paper-300 transition hover:border-ink-500 hover:text-paper-100"
          >
            Open
          </button>

          <button
            onClick={() => setPanel("export")}
            disabled={!ed.isReady}
            className="focus-ring rounded-md bg-amber-500 px-3 py-1.5 text-xs font-medium text-ink-900 transition hover:bg-amber-400 disabled:opacity-35"
          >
            Export
          </button>
        </div>
      </header>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) ed.loadFile(f);
          e.target.value = "";
        }}
      />

      {/* ---------------- body ---------------- */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* stage */}
        <main
          className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-ink-800 p-3 sm:p-6"
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
        >
          <canvas
            ref={ed.attachCanvas}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className="max-h-full max-w-full touch-none rounded-sm shadow-[0_20px_60px_-20px_rgba(0,0,0,0.8)]"
            style={{ display: ed.isReady ? "block" : "none" }}
          />

          {/* Selective markers, laid over the picture at its display size. */}
          {isSelective && ed.isReady && ed.displaySize && ed.imageSize && (
            <div
              className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
              style={{ width: ed.displaySize.w, height: ed.displaySize.h }}
            >
              {ed.params.points.map((p, i) => {
                const at = sourceToFrame(
                  ed.params,
                  p,
                  ed.imageSize!.w,
                  ed.imageSize!.h
                );
                if (at.x < -0.05 || at.x > 1.05 || at.y < -0.05 || at.y > 1.05) {
                  return null;
                }
                const active = i === activePoint;
                return (
                  <div
                    key={i}
                    className="absolute -translate-x-1/2 -translate-y-1/2"
                    style={{ left: `${at.x * 100}%`, top: `${at.y * 100}%` }}
                  >
                    {active && (
                      <div
                        className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-amber-300/35"
                        style={{
                          left: 0,
                          top: 0,
                          // The mask radius is a fraction of the source
                          // height, so a crop makes it cover more of what
                          // is left — which is what the ring has to show.
                          width:
                            ((p.size * 2) / ed.params.cropH) *
                            ed.displaySize!.h,
                          height:
                            ((p.size * 2) / ed.params.cropH) *
                            ed.displaySize!.h,
                        }}
                      />
                    )}
                    <div
                      className={`flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border text-[10px] font-medium ${
                        active
                          ? "border-amber-300 bg-amber-400/90 text-ink-900"
                          : "border-paper-100/70 bg-ink-900/70 text-paper-200"
                      }`}
                    >
                      {i + 1}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {!ed.isReady && (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="focus-ring group flex max-w-md flex-col items-center gap-4 rounded-xl border border-dashed border-ink-600 px-10 py-14 text-center transition hover:border-amber-500/60"
            >
              <Mark size={52} className="opacity-80 transition group-hover:opacity-100" />
              <div>
                <p className="text-sm font-medium text-paper-200">
                  Drop a photo here, or click to browse
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-paper-400">
                  Everything runs on your machine. The file is never uploaded,
                  and nothing is written to a server.
                </p>
              </div>
            </button>
          )}

          {/* Live readout of the parameter under the finger. */}
          {ed.isReady && isSelective && ed.params.points[activePoint] && (
            <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full border border-ink-600/80 bg-ink-900/85 px-3.5 py-1.5 backdrop-blur">
              <span className="text-xs text-paper-300">
                Point {activePoint + 1} · {POINT_CHANNELS[pointChannel].label}
              </span>
              <span className="tabular ml-2.5 text-xs font-medium text-amber-400">
                {Math.round(
                  ed.params.points[activePoint][
                    POINT_CHANNELS[pointChannel].key
                  ] * 100
                )}
              </span>
            </div>
          )}

          {ed.isReady && !isSelective && slider && (
            <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full border border-ink-600/80 bg-ink-900/85 px-3.5 py-1.5 backdrop-blur">
              <span className="text-xs text-paper-300">{slider.label}</span>
              <span className="tabular ml-2.5 text-xs font-medium text-amber-400">
                {formatValue(slider, ed.params[slider.key] as number)}
              </span>
            </div>
          )}

          {ed.error && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-md border border-amber-600/50 bg-ink-900/95 px-3.5 py-2 text-xs text-amber-200">
              {ed.error}
              <button
                onClick={ed.clearError}
                className="focus-ring ml-3 rounded text-paper-400 underline"
              >
                dismiss
              </button>
            </div>
          )}
        </main>

        {/* panel */}
        <aside className="flex w-full shrink-0 flex-col border-t border-ink-700 bg-ink-900 lg:w-[340px] lg:border-l lg:border-t-0">
          <nav className="flex shrink-0 border-b border-ink-700">
            {(["tools", "stack", "chain", "export"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPanel(p)}
                className={`focus-ring flex-1 border-b-2 px-3 py-2.5 text-xs font-medium capitalize transition ${
                  panel === p
                    ? "border-amber-500 text-paper-100"
                    : "border-transparent text-paper-400 hover:text-paper-200"
                }`}
              >
                {p}
              </button>
            ))}
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {panel === "tools" && (
              <ToolsPanel
                grouped={grouped}
                activeToolId={activeToolId}
                onSelectTool={(id) => {
                  setActiveToolId(id);
                  setSliderIndex(0);
                }}
                tool={tool}
                params={ed.params}
                imageSize={ed.imageSize}
                sliderIndex={sliderIndex}
                onSliderFocus={setSliderIndex}
                onChange={(k, v) => ed.setParam(k, v)}
                onCommit={(label) => ed.commit(label)}
                onFraming={applyFraming}
                activePoint={activePoint}
                pointChannel={pointChannel}
                onSelectPoint={setActivePoint}
                onSelectChannel={setPointChannel}
                onPointChange={updatePoint}
                onRemovePoint={removePoint}
              />
            )}
            {panel === "stack" && (
              <StackPanel
                history={ed.history}
                cursor={ed.cursor}
                params={ed.params}
                onReset={ed.reset}
                onShare={async () => {
                  const { code } = await ed.shareLook("Untitled Look");
                  const url = `${location.origin}/edit?look=${code}`;
                  await navigator.clipboard.writeText(url);
                  notify("Look link copied to clipboard");
                }}
                onPaste={async () => {
                  const text = await navigator.clipboard.readText();
                  const code = text.includes("look=") ? text.split("look=")[1] : text;
                  const look = ed.loadLook(code);
                  if (look) {
                    setParentId(look.id);
                    notify(`Applied "${look.name}"`);
                  }
                }}
              />
            )}
            {panel === "chain" && (
              <ChainPanel
                params={ed.params}
                parentId={parentId}
                onNotify={notify}
              />
            )}
            {panel === "export" && (
              <ExportPanel
                disabled={!ed.isReady}
                imageSize={framed}
                onExport={async (opts) => {
                  const blob = await ed.exportImage(opts);
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(blob);
                  const ext = opts.type === "image/png" ? "png" : "jpg";
                  a.download = `grainroom-${Date.now()}.${ext}`;
                  a.click();
                  URL.revokeObjectURL(a.href);
                  notify(`Saved · ${(blob.size / 1024 / 1024).toFixed(2)} MB`);
                }}
              />
            )}
          </div>
        </aside>
      </div>

      {toast && (
        <div className="rise fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full border border-ink-600 bg-ink-800 px-4 py-2 text-xs text-paper-200 shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

/* ================================================================== */

function ToolsPanel({
  grouped,
  activeToolId,
  onSelectTool,
  tool,
  params,
  imageSize,
  sliderIndex,
  onSliderFocus,
  onChange,
  onCommit,
  onFraming,
  activePoint,
  pointChannel,
  onSelectPoint,
  onSelectChannel,
  onPointChange,
  onRemovePoint,
}: {
  grouped: Map<ToolGroup, Tool[]>;
  activeToolId: string;
  onSelectTool: (id: string) => void;
  tool: Tool;
  params: LookParams;
  imageSize: { w: number; h: number } | null;
  sliderIndex: number;
  onSliderFocus: (i: number) => void;
  onChange: (key: keyof LookParams, value: never) => void;
  onCommit: (label: string) => void;
  onFraming: (
    patch: Partial<LookParams>,
    label: string,
    commit?: boolean
  ) => void;
  activePoint: number;
  pointChannel: number;
  onSelectPoint: (i: number) => void;
  onSelectChannel: (i: number) => void;
  onPointChange: (
    index: number,
    patch: Partial<SelectivePoint>,
    commit?: boolean
  ) => void;
  onRemovePoint: (i: number) => void;
}) {
  return (
    <div className="p-3">
      {[...grouped.entries()].map(([group, tools]) => (
        <section key={group} className="mb-4">
          <h3 className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-paper-400">
            {GROUP_LABELS[group]}
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {tools.map((t) => (
              <button
                key={t.id}
                onClick={() => onSelectTool(t.id)}
                className={`focus-ring rounded-md border px-2.5 py-1.5 text-xs transition ${
                  activeToolId === t.id
                    ? "border-amber-500/70 bg-amber-500/10 text-amber-200"
                    : "border-ink-600 text-paper-300 hover:border-ink-500 hover:text-paper-100"
                }`}
              >
                {t.name}
              </button>
            ))}
          </div>
        </section>
      ))}

      <div className="mt-5 rounded-lg border border-ink-700 bg-ink-800/60 p-3">
        <p className="text-xs font-medium text-paper-200">{tool.name}</p>
        <p className="mt-1 text-[11px] leading-relaxed text-paper-400">{tool.blurb}</p>

        <div className="mt-4 space-y-3.5">
          {tool.sliders.map((s, i) => (
            <SliderRow
              key={s.key}
              slider={s}
              value={params[s.key] as number}
              active={i === sliderIndex}
              onFocus={() => onSliderFocus(i)}
              onChange={(v) => onChange(s.key, v as never)}
              onCommit={() => onCommit(`${tool.name} · ${s.label}`)}
            />
          ))}

          {tool.id === "hsl" && (
            <HSLControls params={params} onChange={onChange} onCommit={onCommit} />
          )}
          {tool.id === "black-white" && (
            <BWControls params={params} onChange={onChange} onCommit={onCommit} />
          )}
          {tool.id === "curves" && <CurvesNote />}
          {tool.id === "selective" && (
            <SelectiveControls
              points={params.points}
              active={activePoint}
              channel={pointChannel}
              onSelect={onSelectPoint}
              onChannel={onSelectChannel}
              onChange={onPointChange}
              onRemove={onRemovePoint}
            />
          )}
          {tool.id === "crop" && (
            <FrameControls
              params={params}
              imageSize={imageSize}
              onFraming={onFraming}
            />
          )}
        </div>
      </div>

      <section className="mt-5">
        <h3 className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-paper-400">
          Next milestone
        </h3>
        <ul className="space-y-1">
          {ROADMAP_TOOLS.map((r) => (
            <li
              key={r.name}
              className="flex items-baseline justify-between rounded px-1 py-1 text-[11px]"
            >
              <span className="text-paper-400">{r.name}</span>
              <span className="text-paper-400/60">{r.note}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function SliderRow({
  slider,
  value,
  active,
  onFocus,
  onChange,
  onCommit,
}: {
  slider: Slider;
  value: number;
  active: boolean;
  onFocus: () => void;
  onChange: (v: number) => void;
  onCommit: () => void;
}) {
  const pct = ((value - slider.min) / (slider.max - slider.min)) * 100;
  const neutralPct =
    ((slider.neutral - slider.min) / (slider.max - slider.min)) * 100;

  return (
    <div
      className={`rounded-md px-1.5 py-1 transition ${
        active ? "bg-ink-700/60" : ""
      }`}
      onPointerDown={onFocus}
    >
      <div className="flex items-baseline justify-between">
        <label className="text-[11px] text-paper-300">{slider.label}</label>
        <button
          onDoubleClick={() => {
            onChange(slider.neutral);
            onCommit();
          }}
          className="tabular focus-ring rounded text-[11px] font-medium text-amber-400"
          title="Double-click to reset"
        >
          {formatValue(slider, value)}
        </button>
      </div>

      <div className="relative mt-1.5 h-4">
        {/* Tick at the neutral position, so "back to zero" is findable. */}
        <div className="absolute inset-x-0 top-1.5 h-1 rounded-full bg-ink-600" />
        <div
          className="absolute top-1.5 h-1 rounded-full bg-amber-500"
          style={{
            left: `${Math.min(pct, neutralPct)}%`,
            width: `${Math.abs(pct - neutralPct)}%`,
          }}
        />
        <div
          className="absolute top-0.5 h-3 w-px bg-ink-400"
          style={{ left: `${neutralPct}%` }}
        />
        <input
          type="range"
          min={slider.min}
          max={slider.max}
          step={slider.step ?? 0.01}
          value={value}
          onFocus={onFocus}
          onChange={(e) => onChange(Number(e.target.value))}
          onPointerUp={onCommit}
          onKeyUp={onCommit}
          aria-label={slider.label}
          className="absolute inset-0 w-full cursor-pointer appearance-none bg-transparent
            [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-ink-900
            [&::-webkit-slider-thumb]:bg-paper-100
            [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5
            [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0
            [&::-moz-range-thumb]:bg-paper-100"
        />
      </div>

      {slider.hint && active && (
        <p className="mt-1 text-[10px] leading-snug text-paper-400/80">{slider.hint}</p>
      )}
    </div>
  );
}

function HSLControls({
  params,
  onChange,
  onCommit,
}: {
  params: LookParams;
  onChange: (key: keyof LookParams, value: never) => void;
  onCommit: (label: string) => void;
}) {
  const [band, setBand] = useState(0);
  const rows: { key: "hueShift" | "satShift" | "lumShift"; label: string }[] = [
    { key: "hueShift", label: "Hue" },
    { key: "satShift", label: "Saturation" },
    { key: "lumShift", label: "Luminance" },
  ];

  return (
    <div className="space-y-2.5 pt-1">
      <div className="flex flex-wrap gap-1">
        {HSL_BANDS.map((b, i) => (
          <button
            key={b}
            onClick={() => setBand(i)}
            className={`focus-ring rounded px-1.5 py-1 text-[10px] transition ${
              band === i
                ? "bg-amber-500/15 text-amber-200"
                : "text-paper-400 hover:text-paper-200"
            }`}
          >
            {b}
          </button>
        ))}
      </div>
      {rows.map((r) => (
        <div key={r.key} className="px-1.5">
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] text-paper-300">{r.label}</span>
            <span className="tabular text-[11px] text-amber-400">
              {Math.round((params[r.key][band] as number) * 100)}
            </span>
          </div>
          <input
            type="range"
            min={-1}
            max={1}
            step={0.01}
            value={params[r.key][band]}
            aria-label={`${HSL_BANDS[band]} ${r.label}`}
            onChange={(e) => {
              const next = [...params[r.key]];
              next[band] = Number(e.target.value);
              onChange(r.key, next as never);
            }}
            onPointerUp={() => onCommit(`HSL · ${HSL_BANDS[band]} ${r.label}`)}
            className="mt-1 w-full accent-amber-500"
          />
        </div>
      ))}
    </div>
  );
}

function BWControls({
  params,
  onChange,
  onCommit,
}: {
  params: LookParams;
  onChange: (key: keyof LookParams, value: never) => void;
  onCommit: (label: string) => void;
}) {
  const presets: { name: string; mix: [number, number, number] }[] = [
    { name: "Neutral", mix: [0.2126, 0.7152, 0.0722] },
    { name: "Red filter", mix: [0.72, 0.22, 0.06] },
    { name: "Orange", mix: [0.52, 0.4, 0.08] },
    { name: "Yellow", mix: [0.38, 0.52, 0.1] },
    { name: "Green", mix: [0.12, 0.7, 0.18] },
    { name: "Blue", mix: [0.1, 0.28, 0.62] },
  ];

  return (
    <div className="space-y-2.5 px-1.5 pt-1">
      <label className="flex items-center gap-2 text-[11px] text-paper-300">
        <input
          type="checkbox"
          checked={params.bw}
          onChange={(e) => {
            onChange("bw", e.target.checked as never);
            onCommit("Black & White");
          }}
          className="accent-amber-500"
        />
        Convert to black &amp; white
      </label>

      <div className="flex flex-wrap gap-1">
        {presets.map((p) => (
          <button
            key={p.name}
            disabled={!params.bw}
            onClick={() => {
              onChange("bwMix", p.mix as never);
              onCommit(`B&W · ${p.name}`);
            }}
            className="focus-ring rounded border border-ink-600 px-1.5 py-1 text-[10px] text-paper-300 transition hover:border-ink-500 disabled:opacity-35"
          >
            {p.name}
          </button>
        ))}
      </div>
      <p className="text-[10px] leading-snug text-paper-400/80">
        A colour filter over black and white film darkens its opposite. The red
        preset is what makes a blue sky go dramatic.
      </p>
    </div>
  );
}

function SelectiveControls({
  points,
  active,
  channel,
  onSelect,
  onChannel,
  onChange,
  onRemove,
}: {
  points: SelectivePoint[];
  active: number;
  channel: number;
  onSelect: (i: number) => void;
  onChannel: (i: number) => void;
  onChange: (
    index: number,
    patch: Partial<SelectivePoint>,
    commit?: boolean
  ) => void;
  onRemove: (i: number) => void;
}) {
  const point = points[active];

  if (!point) {
    return (
      <p className="px-1.5 text-[11px] leading-relaxed text-paper-400">
        Tap the photo to leave a point where you want the change. Drag sideways
        to move the value, up and down to swap between brightness, contrast,
        saturation and how far the point reaches.
      </p>
    );
  }

  return (
    <div className="space-y-3 px-1.5 pt-1">
      <div className="flex flex-wrap items-center gap-1">
        {points.map((_, i) => (
          <button
            key={i}
            onClick={() => onSelect(i)}
            className={`focus-ring h-6 w-6 rounded-full border text-[10px] transition ${
              i === active
                ? "border-amber-400 bg-amber-500/20 text-amber-200"
                : "border-ink-600 text-paper-400 hover:border-ink-500"
            }`}
          >
            {i + 1}
          </button>
        ))}
        <button
          onClick={() => onRemove(active)}
          className="focus-ring ml-auto rounded border border-ink-600 px-1.5 py-1 text-[10px] text-paper-400 transition hover:border-amber-600/50 hover:text-amber-200"
        >
          Remove point {active + 1}
        </button>
      </div>

      {POINT_CHANNELS.map((ch, i) => (
        <div
          key={ch.key}
          className={`rounded-md px-1.5 py-1 transition ${
            i === channel ? "bg-ink-700/60" : ""
          }`}
          onPointerDown={() => onChannel(i)}
        >
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] text-paper-300">{ch.label}</span>
            <span className="tabular text-[11px] text-amber-400">
              {ch.key === "size"
                ? `${Math.round(point.size * 100)}`
                : `${point[ch.key] > 0 ? "+" : ""}${Math.round(
                    point[ch.key] * 100
                  )}`}
            </span>
          </div>
          <input
            type="range"
            min={ch.min}
            max={ch.max}
            step={0.01}
            value={point[ch.key]}
            aria-label={`Point ${active + 1} ${ch.label}`}
            onChange={(e) =>
              onChange(active, { [ch.key]: Number(e.target.value) }, false)
            }
            onPointerUp={() => onChange(active, {})}
            onKeyUp={() => onChange(active, {})}
            className="mt-1 w-full accent-amber-500"
          />
        </div>
      ))}

      <p className="text-[10px] leading-snug text-paper-400/80">
        The point holds to tones like the one underneath it, so brightening a
        face does not drag the wall behind it along too.
      </p>
    </div>
  );
}

/**
 * Framing without a drag surface on the canvas.
 *
 * The rectangle is driven by a ratio, a size and two offsets rather than by
 * corner handles. That is less direct than dragging, but it is exact, it works
 * the same on a phone as on a desktop, and every value it produces is one the
 * shader already understands — the handles land on top of this later without
 * changing what a Look means.
 */
function FrameControls({
  params,
  imageSize,
  onFraming,
}: {
  params: LookParams;
  imageSize: { w: number; h: number } | null;
  onFraming: (
    patch: Partial<LookParams>,
    label: string,
    commit?: boolean
  ) => void;
}) {
  const source = imageSize ?? { w: 1000, h: 1000 };
  const turned = params.quarterTurns % 2 === 1;
  const oriented = turned
    ? { w: source.h, h: source.w }
    : { w: source.w, h: source.h };

  // Aspect of the rectangle as it stands, in pixels rather than fractions.
  const aspect =
    (params.cropW * oriented.w) / Math.max(params.cropH * oriented.h, 1e-6);
  // The same shape grown until it touches the edges: the ceiling for Size.
  const fitted = fitCropToRatio(params, aspect, source.w, source.h);
  const size = clamp(params.cropW / Math.max(fitted.cropW, 1e-6), 0.2, 1);

  const room = { x: 1 - params.cropW, y: 1 - params.cropH };
  const offset = {
    x: room.x > 1e-6 ? params.cropX / room.x : 0.5,
    y: room.y > 1e-6 ? params.cropY / room.y : 0.5,
  };

  const setSize = (s: number) => {
    const cw = fitted.cropW * s;
    const ch = fitted.cropH * s;
    onFraming(
      {
        cropW: cw,
        cropH: ch,
        cropX: clamp(params.cropX + params.cropW / 2 - cw / 2, 0, 1 - cw),
        cropY: clamp(params.cropY + params.cropH / 2 - ch / 2, 0, 1 - ch),
      },
      `Crop · ${Math.round(s * 100)}%`,
      false
    );
  };

  const setRatio = (label: string, ratio: number) => {
    const target = ratio === 0 ? oriented.w / oriented.h : ratio;
    const next = fitCropToRatio(params, target, source.w, source.h);
    // Keep whatever size the rectangle already had, so switching between
    // ratios does not silently zoom back out to the full frame.
    onFraming(
      {
        cropW: next.cropW * size,
        cropH: next.cropH * size,
        cropX: clamp(
          params.cropX + params.cropW / 2 - (next.cropW * size) / 2,
          0,
          1 - next.cropW * size
        ),
        cropY: clamp(
          params.cropY + params.cropH / 2 - (next.cropH * size) / 2,
          0,
          1 - next.cropH * size
        ),
      },
      `Crop · ${label}`
    );
  };

  /**
   * A quarter turn moves the crop rectangle with the photo. Leaving it where
   * it was would slide the framing onto a different part of the picture,
   * which is never what someone rotating a photo meant to happen.
   */
  const turn = (dir: 1 | -1) => {
    const { cropX: x, cropY: y, cropW: w, cropH: h } = params;
    const rotated =
      dir === 1
        ? { cropX: 1 - y - h, cropY: x, cropW: h, cropH: w }
        : { cropX: y, cropY: 1 - x - w, cropW: h, cropH: w };
    onFraming(
      { ...rotated, quarterTurns: (params.quarterTurns + dir + 4) % 4 },
      dir === 1 ? "Rotate right" : "Rotate left"
    );
  };

  const ratios = CROP_RATIOS.filter((r) => r.ratio !== null);
  const activeRatio = ratios.find(
    (r) =>
      Math.abs((r.ratio === 0 ? oriented.w / oriented.h : r.ratio!) - aspect) <
      0.01
  );

  return (
    <div className="space-y-3 px-1.5 pt-1">
      <div>
        <p className="mb-1.5 text-[10px] uppercase tracking-[0.12em] text-paper-400">
          Ratio
        </p>
        <div className="flex flex-wrap gap-1">
          {ratios.map((r) => (
            <button
              key={r.label}
              onClick={() => setRatio(r.label, r.ratio!)}
              className={`focus-ring rounded border px-1.5 py-1 text-[10px] transition ${
                activeRatio?.label === r.label
                  ? "border-amber-500/70 bg-amber-500/10 text-amber-200"
                  : "border-ink-600 text-paper-300 hover:border-ink-500"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <FrameSlider
        label="Size"
        value={size}
        min={0.2}
        max={1}
        readout={`${Math.round(size * 100)}%`}
        onChange={setSize}
        onRelease={() => onFraming({}, `Crop · ${Math.round(size * 100)}%`)}
      />
      <FrameSlider
        label="Move across"
        value={offset.x}
        min={0}
        max={1}
        disabled={room.x <= 1e-6}
        readout={`${Math.round(offset.x * 100)}`}
        onChange={(v) =>
          onFraming(
            { cropX: clamp(v * room.x, 0, room.x) },
            "Crop · position",
            false
          )
        }
        onRelease={() => onFraming({}, "Crop · position")}
      />
      <FrameSlider
        label="Move down"
        value={offset.y}
        min={0}
        max={1}
        disabled={room.y <= 1e-6}
        readout={`${Math.round(offset.y * 100)}`}
        onChange={(v) =>
          onFraming(
            { cropY: clamp(v * room.y, 0, room.y) },
            "Crop · position",
            false
          )
        }
        onRelease={() => onFraming({}, "Crop · position")}
      />

      <div>
        <p className="mb-1.5 text-[10px] uppercase tracking-[0.12em] text-paper-400">
          Orientation
        </p>
        <div className="flex flex-wrap gap-1">
          <FrameButton onClick={() => turn(-1)}>Rotate left</FrameButton>
          <FrameButton onClick={() => turn(1)}>Rotate right</FrameButton>
          <FrameButton
            active={params.flipH}
            onClick={() => onFraming({ flipH: !params.flipH }, "Mirror across")}
          >
            Mirror
          </FrameButton>
          <FrameButton
            active={params.flipV}
            onClick={() => onFraming({ flipV: !params.flipV }, "Flip upright")}
          >
            Flip
          </FrameButton>
        </div>
      </div>

      <button
        disabled={isUnframed(params)}
        onClick={() =>
          onFraming(
            {
              cropX: 0,
              cropY: 0,
              cropW: 1,
              cropH: 1,
              quarterTurns: 0,
              straighten: 0,
              flipH: false,
              flipV: false,
            },
            "Framing cleared"
          )
        }
        className="focus-ring w-full rounded-md border border-ink-600 px-2 py-1.5 text-[10px] text-paper-400 transition hover:border-ink-500 hover:text-paper-200 disabled:opacity-35"
      >
        Back to the full frame
      </button>
    </div>
  );
}

function FrameSlider({
  label,
  value,
  min,
  max,
  readout,
  disabled,
  onChange,
  onRelease,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  readout: string;
  disabled?: boolean;
  onChange: (v: number) => void;
  onRelease: () => void;
}) {
  return (
    <div className={disabled ? "opacity-40" : undefined}>
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] text-paper-300">{label}</span>
        <span className="tabular text-[11px] text-amber-400">{readout}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={0.005}
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onRelease}
        onKeyUp={onRelease}
        className="mt-1 w-full accent-amber-500"
      />
    </div>
  );
}

function FrameButton({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`focus-ring rounded border px-1.5 py-1 text-[10px] transition ${
        active
          ? "border-amber-500/70 bg-amber-500/10 text-amber-200"
          : "border-ink-600 text-paper-300 hover:border-ink-500"
      }`}
    >
      {children}
    </button>
  );
}

function CurvesNote() {
  return (
    <p className="px-1.5 text-[11px] leading-relaxed text-paper-400">
      The curve engine is wired and running — monotone cubic through the control
      points, baked to a 256-step lookup each frame. The point-dragging surface
      lands in the next milestone; until then the tone sliders drive it.
    </p>
  );
}

/* ================================================================== */

function StackPanel({
  history,
  cursor,
  params,
  onReset,
  onShare,
  onPaste,
}: {
  history: { params: LookParams; label: string; at: number }[];
  cursor: number;
  params: LookParams;
  onReset: () => void;
  onShare: () => void;
  onPaste: () => void;
}) {
  const touched = useMemo(
    () => TOOLS.map((t) => ({ tool: t, active: activeSliders(t, params) })).filter(
      (x) => x.active.length > 0
    ),
    [params]
  );

  return (
    <div className="space-y-4 p-3">
      <div className="flex gap-1.5">
        <button
          onClick={onShare}
          className="focus-ring flex-1 rounded-md bg-amber-500 px-3 py-2 text-xs font-medium text-ink-900 transition hover:bg-amber-400"
        >
          Copy Look link
        </button>
        <button
          onClick={onPaste}
          className="focus-ring rounded-md border border-ink-600 px-3 py-2 text-xs text-paper-300 transition hover:border-ink-500 hover:text-paper-100"
        >
          Paste
        </button>
      </div>

      <section>
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-paper-400">
          Current Look
        </h3>
        {params.points.length > 0 && (
          <div className="mb-2 rounded-md border border-ink-700 p-2">
            <p className="text-[11px] font-medium text-paper-200">Selective</p>
            <p className="mt-1 text-[10px] text-paper-400">
              {params.points.length}{" "}
              {params.points.length === 1 ? "point" : "points"} placed on the
              photo
            </p>
          </div>
        )}
        {!isUnframed(params) && (
          <div className="mb-2 rounded-md border border-ink-700 p-2">
            <p className="text-[11px] font-medium text-paper-200">Framing</p>
            <p className="mt-1 text-[10px] text-paper-400">
              {describeFraming(params)}
            </p>
          </div>
        )}
        {touched.length === 0 ? (
          isUnframed(params) && params.points.length === 0 ? (
            <p className="text-[11px] text-paper-400">
              Nothing applied yet. The photo is untouched.
            </p>
          ) : null
        ) : (
          <ul className="space-y-2">
            {touched.map(({ tool, active }) => (
              <li key={tool.id} className="rounded-md border border-ink-700 p-2">
                <p className="text-[11px] font-medium text-paper-200">{tool.name}</p>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                  {active.map(({ slider, value }) => (
                    <span key={slider.key} className="text-[10px] text-paper-400">
                      {slider.label}
                      <span className="tabular ml-1 text-amber-400/90">
                        {formatValue(slider, value)}
                      </span>
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-paper-400">
          History
        </h3>
        {history.length === 0 ? (
          <p className="text-[11px] text-paper-400">No steps recorded.</p>
        ) : (
          <ol className="space-y-0.5">
            {history.map((h, i) => (
              <li
                key={h.at + String(i)}
                className={`rounded px-2 py-1 text-[11px] ${
                  i === cursor
                    ? "bg-amber-500/10 text-amber-200"
                    : i > cursor
                    ? "text-paper-400/45"
                    : "text-paper-300"
                }`}
              >
                <span className="tabular mr-2 text-paper-400/60">
                  {String(i + 1).padStart(2, "0")}
                </span>
                {h.label}
              </li>
            ))}
          </ol>
        )}
      </section>

      <button
        onClick={onReset}
        className="focus-ring w-full rounded-md border border-ink-600 px-3 py-2 text-xs text-paper-400 transition hover:border-amber-600/50 hover:text-amber-200"
      >
        Revert to original
      </button>
    </div>
  );
}

function ExportPanel({
  disabled,
  imageSize,
  onExport,
}: {
  disabled: boolean;
  imageSize: { w: number; h: number } | null;
  onExport: (o: { type: string; quality: number; maxEdge?: number }) => Promise<void>;
}) {
  const [format, setFormat] = useState("image/jpeg");
  const [quality, setQuality] = useState(0.95);
  const [sizeKey, setSizeKey] = useState("full");
  const [busy, setBusy] = useState(false);

  const sizes = [
    { key: "full", label: "Full resolution", maxEdge: undefined },
    { key: "4096", label: "4096 px", maxEdge: 4096 },
    { key: "2048", label: "2048 px", maxEdge: 2048 },
    { key: "1080", label: "1080 px", maxEdge: 1080 },
  ];
  const chosen = sizes.find((s) => s.key === sizeKey)!;

  const outDims = useMemo(() => {
    if (!imageSize) return null;
    if (!chosen.maxEdge) return imageSize;
    const longest = Math.max(imageSize.w, imageSize.h);
    if (longest <= chosen.maxEdge) return imageSize;
    const s = chosen.maxEdge / longest;
    return { w: Math.round(imageSize.w * s), h: Math.round(imageSize.h * s) };
  }, [imageSize, chosen]);

  return (
    <div className="space-y-4 p-3">
      <Field label="Format">
        <div className="flex gap-1.5">
          {[
            { v: "image/jpeg", l: "JPEG" },
            { v: "image/png", l: "PNG" },
            { v: "image/webp", l: "WebP" },
          ].map((f) => (
            <button
              key={f.v}
              onClick={() => setFormat(f.v)}
              className={`focus-ring flex-1 rounded-md border px-2 py-1.5 text-xs transition ${
                format === f.v
                  ? "border-amber-500/70 bg-amber-500/10 text-amber-200"
                  : "border-ink-600 text-paper-300 hover:border-ink-500"
              }`}
            >
              {f.l}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Size">
        <div className="grid grid-cols-2 gap-1.5">
          {sizes.map((s) => (
            <button
              key={s.key}
              onClick={() => setSizeKey(s.key)}
              className={`focus-ring rounded-md border px-2 py-1.5 text-xs transition ${
                sizeKey === s.key
                  ? "border-amber-500/70 bg-amber-500/10 text-amber-200"
                  : "border-ink-600 text-paper-300 hover:border-ink-500"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        {outDims && (
          <p className="tabular mt-1.5 text-[10px] text-paper-400">
            Output {outDims.w} × {outDims.h}
          </p>
        )}
      </Field>

      {format !== "image/png" && (
        <Field label={`Quality · ${Math.round(quality * 100)}`}>
          <input
            type="range"
            min={0.5}
            max={1}
            step={0.01}
            value={quality}
            onChange={(e) => setQuality(Number(e.target.value))}
            className="w-full accent-amber-500"
            aria-label="Export quality"
          />
        </Field>
      )}

      <button
        disabled={disabled || busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onExport({ type: format, quality, maxEdge: chosen.maxEdge });
          } finally {
            setBusy(false);
          }
        }}
        className="focus-ring w-full rounded-md bg-amber-500 px-3 py-2.5 text-xs font-medium text-ink-900 transition hover:bg-amber-400 disabled:opacity-35"
      >
        {busy ? "Rendering…" : "Save to device"}
      </button>

      <p className="text-[10px] leading-relaxed text-paper-400/80">
        The export re-renders at full resolution rather than upscaling the
        preview, so the file you save is the one the GPU computed, not a
        stretched screenshot. No watermark is applied at any size.
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-paper-400">
        {label}
      </p>
      {children}
    </div>
  );
}

function IconButton({
  label,
  shortcut,
  disabled,
  onClick,
  children,
}: {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      className="focus-ring rounded-md border border-ink-600 p-1.5 text-paper-300 transition hover:border-ink-500 hover:text-paper-100 disabled:opacity-30"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
    </button>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Index of the point under a tap, or -1 to mean "none, place a new one".
 *
 * The hit radius is fixed in frame terms rather than tied to the point's own
 * size: a point tuned down to a small mask still has to be easy to grab back.
 */
function nearestPoint(
  params: LookParams,
  uv: { x: number; y: number },
  size: { w: number; h: number }
): number {
  let best = -1;
  let bestDist = 0.05;
  params.points.forEach((p, i) => {
    const at = sourceToFrame(params, p, size.w, size.h);
    const d = Math.hypot(at.x - uv.x, at.y - uv.y);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}

/** Plain-language summary of the framing, for the Look stack. */
function describeFraming(p: LookParams): string {
  const parts: string[] = [];
  if (p.cropW < 0.999 || p.cropH < 0.999) {
    parts.push(
      `cropped to ${Math.round(p.cropW * 100)} × ${Math.round(p.cropH * 100)} percent`
    );
  }
  if (p.quarterTurns) parts.push(`turned ${p.quarterTurns * 90} degrees`);
  if (p.straighten) parts.push(`straightened ${(p.straighten * 15).toFixed(1)}°`);
  if (p.flipH) parts.push("mirrored");
  if (p.flipV) parts.push("flipped");
  if (p.perspectiveH || p.perspectiveV) parts.push("perspective corrected");
  if (p.expand) parts.push(`expanded ${Math.round(p.expand * 50)} percent`);
  return parts.join(", ");
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
function clampInt(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}
