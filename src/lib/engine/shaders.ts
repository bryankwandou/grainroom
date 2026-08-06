/**
 * Grainroom GPU pipeline.
 *
 * Four passes, all GLSL ES 3.00:
 *   1. ADJUST    tone, colour, curves, targeted HSL, black & white
 *   2. BLUR_H    separable gaussian, horizontal
 *   3. BLUR_V    separable gaussian, vertical
 *   4. COMPOSITE unsharp structure/sharpen against the blurred copy,
 *                then bloom, halation, lens blur, grain, vignette
 *
 * Keeping the low-pass copy around from passes 2-3 is what lets structure,
 * sharpening, bloom and halation all share one blur instead of four.
 */

export const VERT = /* glsl */ `#version 300 es
in vec2 aPos;
out vec2 vUV;
void main() {
  vUV = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

/** Shared colour-space helpers. Prepended to every fragment stage. */
const COLOR_LIB = /* glsl */ `
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

float luma(vec3 c) { return dot(c, LUMA); }

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

/** sRGB <-> linear. Tone maths belongs in linear light. */
vec3 toLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
`;

export const FRAG_ADJUST = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUV;
out vec4 fragColor;

uniform sampler2D uImage;
uniform sampler2D uCurves;   // 256x1 LUT: rgb = per-channel, a = composite

uniform vec4 uTone;    // exposure, contrast, highlights, shadows
uniform vec4 uTone2;   // whites, blacks, fade, ambiance
uniform vec4 uColor;   // saturation, vibrance, temperature, tint
uniform vec4 uSplit;   // shadowHue, shadowSat, highlightHue, highlightSat
uniform vec4 uBW;      // mixR, mixG, mixB, enabled
uniform float uHueShift[8];
uniform float uSatShift[8];
uniform float uLumShift[8];

${COLOR_LIB}

/**
 * Weight for one of the 8 HSL bands. Bands sit every 45 degrees and
 * overlap smoothly so a hue sweep never shows a seam.
 */
float bandWeight(float hue, int band) {
  float center = float(band) / 8.0;
  float d = abs(hue - center);
  d = min(d, 1.0 - d);            // wrap around the hue circle
  return smoothstep(0.125, 0.0, d);
}

void main() {
  vec3 c = texture(uImage, vUV).rgb;
  c = toLinear(c);

  // --- exposure, in stops ---
  c *= pow(2.0, uTone.x);

  // --- temperature / tint, a cheap but well-behaved white balance ---
  c.r *= 1.0 + uColor.z * 0.35;
  c.b *= 1.0 - uColor.z * 0.35;
  c.g *= 1.0 + uColor.w * 0.25;

  c = clamp(c, 0.0, 8.0);
  c = toSRGB(c);

  // --- highlights / shadows, luminance-weighted so midtones stay put ---
  float l = luma(c);
  float hiMask = smoothstep(0.5, 1.0, l);
  float loMask = smoothstep(0.5, 0.0, l);
  c += uTone.z * hiMask * (1.0 - c) * 0.6;   // recover or push highlights
  c += uTone.w * loMask * (c + 0.15) * 0.9;  // lift or crush shadows

  // --- whites / blacks, endpoint moves ---
  c += uTone2.x * smoothstep(0.7, 1.0, l) * 0.5;
  c -= uTone2.y * smoothstep(0.3, 0.0, l) * 0.5;

  // --- contrast around mid-grey ---
  c = (c - 0.5) * (1.0 + uTone.y) + 0.5;

  // --- fade: raise the black point for a matte, printed look ---
  c = mix(c, c * (1.0 - uTone2.z * 0.35) + uTone2.z * 0.14, 1.0);

  c = clamp(c, 0.0, 1.0);

  // --- curves: per channel, then composite ---
  c.r = texture(uCurves, vec2(c.r, 0.5)).r;
  c.g = texture(uCurves, vec2(c.g, 0.5)).g;
  c.b = texture(uCurves, vec2(c.b, 0.5)).b;
  c.r = texture(uCurves, vec2(c.r, 0.5)).a;
  c.g = texture(uCurves, vec2(c.g, 0.5)).a;
  c.b = texture(uCurves, vec2(c.b, 0.5)).a;

  // --- targeted HSL across 8 hue bands ---
  vec3 hsv = rgb2hsv(c);
  float hueAdj = 0.0, satAdj = 0.0, lumAdj = 0.0;
  for (int i = 0; i < 8; i++) {
    float w = bandWeight(hsv.x, i) * hsv.y;  // grey pixels have no hue to shift
    hueAdj += uHueShift[i] * w;
    satAdj += uSatShift[i] * w;
    lumAdj += uLumShift[i] * w;
  }
  hsv.x = fract(hsv.x + hueAdj * 0.08);
  hsv.y = clamp(hsv.y * (1.0 + satAdj), 0.0, 1.0);
  hsv.z = clamp(hsv.z * (1.0 + lumAdj * 0.5), 0.0, 1.0);
  c = hsv2rgb(hsv);

  // --- vibrance before saturation: protect what is already vivid ---
  float sat = rgb2hsv(c).y;
  float vibWeight = 1.0 - sat;
  float g0 = luma(c);
  c = mix(vec3(g0), c, 1.0 + uColor.y * vibWeight);
  c = mix(vec3(luma(c)), c, 1.0 + uColor.x);

  // --- ambiance: Snapseed's signature. Midtone lift plus a gentle
  //     saturation bloom, strongest where the frame is neither lit nor dark. ---
  float amb = uTone2.w;
  if (abs(amb) > 0.001) {
    float mid = 1.0 - abs(luma(c) - 0.5) * 2.0;
    c = mix(vec3(luma(c)), c, 1.0 + amb * 0.5);
    c += amb * mid * 0.12;
  }

  // --- split toning ---
  if (uSplit.y > 0.001 || uSplit.w > 0.001) {
    float sl = luma(c);
    vec3 shTint = hsv2rgb(vec3(uSplit.x, 1.0, 1.0));
    vec3 hiTint = hsv2rgb(vec3(uSplit.z, 1.0, 1.0));
    c = mix(c, c * shTint, uSplit.y * smoothstep(0.6, 0.0, sl));
    c = mix(c, c * hiTint, uSplit.w * smoothstep(0.4, 1.0, sl));
  }

  // --- black & white with a channel mixer, the way a colour filter works ---
  if (uBW.w > 0.5) {
    vec3 w = uBW.rgb / max(uBW.r + uBW.g + uBW.b, 0.001);
    c = vec3(dot(c, w));
  }

  fragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

export const FRAG_BLUR = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUV;
out vec4 fragColor;

uniform sampler2D uImage;
uniform vec2 uDirection;   // texel step, already scaled by radius
uniform float uRadius;

void main() {
  // 9-tap gaussian. Weights are the normalised binomial row.
  float w[5];
  w[0] = 0.2270270270;
  w[1] = 0.1945945946;
  w[2] = 0.1216216216;
  w[3] = 0.0540540541;
  w[4] = 0.0162162162;

  vec3 sum = texture(uImage, vUV).rgb * w[0];
  for (int i = 1; i < 5; i++) {
    vec2 off = uDirection * float(i) * uRadius;
    sum += texture(uImage, vUV + off).rgb * w[i];
    sum += texture(uImage, vUV - off).rgb * w[i];
  }
  fragColor = vec4(sum, 1.0);
}`;

export const FRAG_COMPOSITE = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUV;
out vec4 fragColor;

uniform sampler2D uImage;   // sharp result of the adjust pass
uniform sampler2D uBlur;    // low-pass copy of the same

uniform vec4 uFx;    // structure, sharpen, grain, vignette
uniform vec4 uFx2;   // bloom, halation, dehaze, lensBlur
uniform vec2 uResolution;
uniform float uSeed;
uniform float uVignetteFalloff;

${COLOR_LIB}

/** Cheap value noise. Deterministic per seed so a Look always replays identically. */
float hash(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}

void main() {
  vec3 sharp = texture(uImage, vUV).rgb;
  vec3 blur = texture(uBlur, vUV).rgb;
  vec3 c = sharp;

  // --- lens blur: swap toward the low-pass copy ---
  c = mix(c, blur, clamp(uFx2.w, 0.0, 1.0));

  // --- structure: unsharp mask at a wide radius, so it reads as local
  //     contrast rather than edge sharpening. Detail is protected in
  //     the extremes so skies and shadows do not go crunchy. ---
  if (abs(uFx.x) > 0.001) {
    vec3 detail = sharp - blur;
    float protectMask = 1.0 - abs(luma(sharp) - 0.5) * 1.4;
    c += detail * uFx.x * 2.0 * clamp(protectMask, 0.0, 1.0);
  }

  // --- sharpen: same unsharp, narrow weighting, luminance only ---
  if (uFx.y > 0.001) {
    float dl = luma(sharp) - luma(blur);
    c += dl * uFx.y * 3.0;
  }

  // --- dehaze: pull the black point down and add back saturation ---
  if (uFx2.z > 0.001) {
    float d = uFx2.z;
    c = (c - d * 0.18) / max(1.0 - d * 0.18, 0.01);
    c = mix(vec3(luma(c)), c, 1.0 + d * 0.4);
  }

  // --- bloom: highlights bleed into their neighbours ---
  if (uFx2.x > 0.001) {
    vec3 hi = max(blur - 0.62, 0.0) / 0.38;
    c += hi * uFx2.x * 0.9;
  }

  // --- halation: the red-orange ring film gives around blown highlights ---
  if (uFx2.y > 0.001) {
    float hi = max(luma(blur) - 0.68, 0.0) / 0.32;
    c += vec3(1.0, 0.38, 0.16) * hi * uFx2.y * 1.1;
  }

  // --- vignette, measured on the true aspect so it stays circular ---
  if (abs(uFx.w) > 0.001) {
    vec2 p = (vUV - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
    float r = length(p) / 0.7071;
    float v = smoothstep(uVignetteFalloff, 1.0, r);
    c *= 1.0 - v * uFx.w;
  }

  // --- grain, scaled to output pixels so it does not swim on zoom ---
  if (uFx.z > 0.001) {
    float n = hash(vUV * uResolution + uSeed) - 0.5;
    // Film grain is strongest in the midtones, nearly absent in pure black.
    float shape = 1.0 - abs(luma(c) - 0.45) * 1.2;
    c += n * uFx.z * 0.28 * clamp(shape, 0.15, 1.0);
  }

  fragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;
