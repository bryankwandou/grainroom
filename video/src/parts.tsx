/**
 * The pieces every cut is assembled from.
 *
 * One entrance, one exit, one type scale. A video that reaches for a new
 * technique every eight seconds reads as assembled rather than directed, so
 * the vocabulary here is deliberately small: things develop up out of the
 * ground and settle, the way an image comes up in a tray.
 */
import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont as loadDisplay } from "@remotion/google-fonts/BodoniModa";
import { loadFont as loadBody } from "@remotion/google-fonts/Archivo";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";
import { C, SETTLE } from "./theme";

export const display = loadDisplay().fontFamily;
export const body = loadBody().fontFamily;
export const mono = loadMono().fontFamily;

/** Rise and fade, delayed. The only entrance in the whole film. */
export function useDevelop(delay = 0, travel = 26) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = spring({ frame: frame - delay, fps, config: SETTLE });
  return {
    opacity: interpolate(t, [0, 1], [0, 1]),
    transform: `translateY(${interpolate(t, [0, 1], [travel, 0])}px)`,
  };
}

/** Holds a scene on screen, then takes it away without a hard cut. */
export function Hold({
  children,
  out,
  style,
}: {
  children: React.ReactNode;
  /** Frame at which the scene starts leaving. */
  out: number;
  style?: React.CSSProperties;
}) {
  const frame = useCurrentFrame();
  const leaving = interpolate(frame, [out, out + 18], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ ...style, opacity: leaving }}>{children}</AbsoluteFill>
  );
}

/** The safelight. Fixed, warm, low and to the left, on every frame. */
export function Room({ children }: { children: React.ReactNode }) {
  return (
    <AbsoluteFill style={{ backgroundColor: C.ground }}>
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(120% 90% at 10% -10%, rgba(227,155,46,0.16), transparent 60%)," +
            "radial-gradient(80% 70% at 95% 8%, rgba(116,169,141,0.07), transparent 60%)",
        }}
      />
      {children}
    </AbsoluteFill>
  );
}

export function Eyebrow({
  children,
  delay = 0,
  color = C.safelight,
}: {
  children: React.ReactNode;
  delay?: number;
  color?: string;
}) {
  const s = useDevelop(delay, 12);
  return (
    <div
      style={{
        ...s,
        fontFamily: mono,
        fontSize: 26,
        letterSpacing: 5,
        textTransform: "uppercase",
        color,
      }}
    >
      {children}
    </div>
  );
}

export function Headline({
  children,
  delay = 0,
  size = 108,
}: {
  children: React.ReactNode;
  delay?: number;
  size?: number;
}) {
  const s = useDevelop(delay);
  return (
    <div
      style={{
        ...s,
        fontFamily: display,
        fontWeight: 400,
        fontSize: size,
        lineHeight: 1.03,
        letterSpacing: -2,
        color: C.paper,
        maxWidth: 1400,
      }}
    >
      {children}
    </div>
  );
}

export function Body({
  children,
  delay = 0,
  size = 38,
  color = C.paperDim,
  width = 1100,
}: {
  children: React.ReactNode;
  delay?: number;
  size?: number;
  color?: string;
  width?: number;
}) {
  const s = useDevelop(delay, 18);
  return (
    <div
      style={{
        ...s,
        fontFamily: body,
        fontSize: size,
        lineHeight: 1.5,
        color,
        maxWidth: width,
      }}
    >
      {children}
    </div>
  );
}

/**
 * A frame rendered by the editor itself, mounted like a print: paper border,
 * a shadow under it, and a caption on the mount rather than over the picture.
 */
export function Print({
  src,
  caption,
  delay = 0,
  width = 1180,
}: {
  src: string;
  caption?: string;
  delay?: number;
  width?: number;
}) {
  const s = useDevelop(delay, 34);
  return (
    <div
      style={{
        ...s,
        width,
        padding: 22,
        paddingBottom: caption ? 16 : 22,
        backgroundColor: C.tray,
        border: `1px solid ${C.edge}`,
        boxShadow: "0 60px 120px -60px rgba(0,0,0,0.95)",
      }}
    >
      <Img src={staticFile(src)} style={{ width: "100%", display: "block" }} />
      {caption ? (
        <div
          style={{
            fontFamily: mono,
            fontSize: 21,
            letterSpacing: 2.5,
            textTransform: "uppercase",
            color: C.grey,
            marginTop: 16,
          }}
        >
          {caption}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Two prints in the same mount, the second wiping over the first.
 *
 * Cross-dissolving would read as a slideshow. A wipe reads as one picture
 * being worked on, which is what actually happened.
 */
export function Develop({
  from,
  to,
  at,
  caption,
  delay = 0,
  width = 1180,
}: {
  from: string;
  to: string;
  /** Frame the wipe starts. */
  at: number;
  caption?: string;
  delay?: number;
  width?: number;
}) {
  const frame = useCurrentFrame();
  const s = useDevelop(delay, 34);
  const wipe = interpolate(frame, [at, at + 34], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        ...s,
        width,
        padding: 22,
        paddingBottom: caption ? 16 : 22,
        backgroundColor: C.tray,
        border: `1px solid ${C.edge}`,
        boxShadow: "0 60px 120px -60px rgba(0,0,0,0.95)",
      }}
    >
      <div style={{ position: "relative", lineHeight: 0 }}>
        <Img src={staticFile(from)} style={{ width: "100%", display: "block" }} />
        <Img
          src={staticFile(to)}
          style={{
            width: "100%",
            display: "block",
            position: "absolute",
            inset: 0,
            clipPath: `inset(0 ${100 - wipe}% 0 0)`,
          }}
        />
        {wipe > 0.5 && wipe < 99.5 ? (
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: `${wipe}%`,
              width: 2,
              backgroundColor: "rgba(227,155,46,0.85)",
            }}
          />
        ) : null}
      </div>
      {caption ? (
        <div
          style={{
            fontFamily: mono,
            fontSize: 21,
            letterSpacing: 2.5,
            textTransform: "uppercase",
            color: C.grey,
            marginTop: 16,
          }}
        >
          {caption}
        </div>
      ) : null}
    </div>
  );
}

/** A figure with its unit and a line of explanation under it. */
export function Figure({
  value,
  label,
  delay = 0,
}: {
  value: string;
  label: string;
  delay?: number;
}) {
  const s = useDevelop(delay, 20);
  return (
    <div style={{ ...s, borderTop: `1px solid ${C.edge}`, paddingTop: 18, width: 380 }}>
      <div
        style={{
          fontFamily: display,
          fontSize: 96,
          lineHeight: 1,
          color: C.safelight,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontFamily: body,
          fontSize: 27,
          lineHeight: 1.4,
          color: C.grey,
          marginTop: 14,
        }}
      >
        {label}
      </div>
    </div>
  );
}

/** One line of the settlement, arriving on its own beat. */
export function Row({
  what,
  who,
  amount,
  delay = 0,
  accent = C.paper,
}: {
  what: string;
  who: string;
  amount: string;
  delay?: number;
  accent?: string;
}) {
  const s = useDevelop(delay, 14);
  return (
    <div
      style={{
        ...s,
        display: "flex",
        alignItems: "baseline",
        gap: 28,
        borderBottom: `1px solid ${C.edgeSoft}`,
        padding: "20px 0",
        width: 1320,
      }}
    >
      <div style={{ fontFamily: body, fontSize: 34, color: C.paperDim, flex: 1 }}>
        {what}
      </div>
      <div style={{ fontFamily: body, fontSize: 30, color: C.grey, width: 320 }}>
        {who}
      </div>
      <div
        style={{
          fontFamily: mono,
          fontSize: 36,
          color: accent,
          width: 240,
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {amount}
      </div>
    </div>
  );
}
