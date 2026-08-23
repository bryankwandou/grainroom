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

// Framing. Applied here rather than in a pass of its own so that the blur,
// vignette and grain further down the chain all see the cropped frame and
// land relative to the picture the viewer actually gets.
uniform vec4 uCrop;        // x, y, w, h — a rect in the oriented image
uniform vec2 uOriented;    // pixel size of the image after quarter turns
uniform vec2 uSource;      // pixel size of the source texture
uniform float uQuarter;    // clockwise quarter turns, 0..3
uniform float uAngle;      // straighten, in radians
uniform vec2 uFlip;        // 1.0 keeps an axis, -1.0 mirrors it
uniform float uExpand;     // 1.0 is the plain crop, above that adds border
uniform vec2 uKeystone;    // perspective tilt, horizontal and vertical

// Selective points, positioned in source coordinates so they stay put when
// the framing changes underneath them.
uniform int uPointCount;
uniform vec4 uPointA[6];   // x, y, radius, unused
uniform vec4 uPointB[6];   // brightness, contrast, saturation, unused

uniform int uHealCount;
uniform vec4 uHeal[8];     // x, y, radius, unused

${COLOR_LIB}

/**
 * Maps a point in the output frame back to the pixel it came from.
 *
 * Working backwards rather than forwards means every output pixel gets
 * exactly one sample and there are no seams to fill, which is the usual
 * reason forward-mapped rotation looks torn.
 */
vec2 sourceUV(vec2 uv) {
  // Into the oriented image, then to coordinates centred on the middle of it.
  // Expansion grows outward from the centre of the crop rather than the centre
  // of the photo, so moving the crop does not drag the new border with it.
  vec2 centre = uCrop.xy + uCrop.zw * 0.5;
  vec2 p = (centre + (uv - 0.5) * uCrop.zw * uExpand - 0.5) * uOriented;

  // Undo the quarter turn.
  float turns = mod(uQuarter, 4.0);
  if (turns > 2.5)      p = vec2(-p.y,  p.x);
  else if (turns > 1.5) p = -p;
  else if (turns > 0.5) p = vec2( p.y, -p.x);

  // Undo the straighten, scaling by the same amount the corners were pushed
  // out so the frame stays filled instead of showing wedges of nothing.
  float ca = abs(cos(uAngle));
  float sa = abs(sin(uAngle));
  float zoom = max(
    (uSource.x * ca + uSource.y * sa) / uSource.x,
    (uSource.x * sa + uSource.y * ca) / uSource.y
  );
  float c = cos(-uAngle);
  float s = sin(-uAngle);
  p = vec2(p.x * c - p.y * s, p.x * s + p.y * c) / zoom;

  // Undo the keystone. A projective divide is what makes converging verticals
  // parallel again; the pre-scale is the same auto-zoom the straighten uses,
  // sized off the worst corner so no edge is left sampling past the image.
  if (abs(uKeystone.x) > 0.001 || abs(uKeystone.y) > 0.001) {
    vec2 n = p / uSource;                       // -0.5 .. 0.5 either way
    n *= 1.0 - (abs(uKeystone.x) + abs(uKeystone.y)) * 0.5;
    n /= 1.0 + uKeystone.x * n.x + uKeystone.y * n.y;
    p = n * uSource;
  }

  return p / uSource * uFlip + 0.5;
}

/**
 * Folds a coordinate back inside 0..1 by reflection.
 *
 * Inside the range it changes nothing, so it can stand in for a clamp
 * everywhere. Outside it, the picture continues as its own mirror image,
 * which is what fills the border that Expand opens up — and it is also what
 * stops a steep keystone from smearing one row of pixels across the corner.
 */
vec2 mirrorUV(vec2 uv) {
  vec2 m = mod(uv, 2.0);
  return 1.0 - abs(1.0 - m);
}

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
  vec2 suv = mirrorUV(sourceUV(vUV));
  vec3 c = texture(uImage, suv).rgb;

  // --- healing ---
  // A blemish is filled from the ring of pixels around it, weighted toward
  // the side of the ring the pixel is nearest. That is the cheap end of
  // inpainting: it cannot invent a missing eyebrow, but it takes out a spot
  // on skin or a sensor mark on a sky without leaving a visible disc.
  float aspect = uSource.x / uSource.y;
  for (int i = 0; i < 8; i++) {
    if (i >= uHealCount) break;
    float r = max(uHeal[i].z, 0.002);
    vec2 d = (suv - uHeal[i].xy) * vec2(aspect, 1.0);
    float dist = length(d) / r;
    if (dist >= 1.0) continue;

    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    vec2 dir0 = normalize(d + vec2(1.0e-6));
    for (int k = 0; k < 8; k++) {
      float a = float(k) * 0.7853981634;
      vec2 dir = vec2(cos(a), sin(a));
      vec2 sp = uHeal[i].xy + dir * r * 1.18 / vec2(aspect, 1.0);
      float w = 0.12 + max(dot(dir0, dir), 0.0);
      acc += texture(uImage, mirrorUV(sp)).rgb * w;
      wsum += w;
    }
    c = mix(c, acc / wsum, smoothstep(1.0, 0.6, dist));
  }

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

  // --- selective points ---
  // Distance sets how far the adjustment reaches; the tone under the point
  // sets what it reaches. Without the second half, brightening a face also
  // brightens the wall behind it and the whole thing reads as a smudge.
  for (int i = 0; i < 6; i++) {
    if (i >= uPointCount) break;
    vec2 d = (suv - uPointA[i].xy) * vec2(uSource.x / uSource.y, 1.0);
    float w = smoothstep(1.0, 0.0, length(d) / max(uPointA[i].z, 0.02));
    if (w < 0.002) continue;

    vec3 anchor = texture(uImage, clamp(uPointA[i].xy, 0.0, 1.0)).rgb;
    w *= exp(-abs(luma(c) - luma(anchor)) * 4.0);

    c += uPointB[i].x * w * 0.45;
    c = (c - 0.5) * (1.0 + uPointB[i].y * w) + 0.5;
    c = mix(vec3(luma(c)), c, 1.0 + uPointB[i].z * w);
    c = clamp(c, 0.0, 1.0);
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
uniform sampler2D uText;    // caption, drawn at the output resolution
// Painted mask. Alpha is how much brush landed on this pixel; red, green and
// blue are the shares of it that were dodging, burning and saturating. What
// the three do not account for is the share that was desaturating.
uniform sampler2D uPaint;

uniform vec4 uFx;    // structure, sharpen, grain, vignette
uniform vec4 uFx2;   // bloom, halation, dehaze, lensBlur
uniform vec2 uResolution;
uniform float uSeed;
uniform float uVignetteFalloff;
uniform vec2 uBorder;    // width as a fraction of the short edge, then its tone
uniform vec3 uPortrait;  // skin smoothing, face spotlight, eye clarity
uniform float uTextOpacity;
uniform float uPaintOn;

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

  // --- painted dodge, burn and saturation ---
  // Dodging holds the highlights and burning holds the shadows, the way the
  // paper does: past the end of the scale there is nothing left to move, and
  // pushing anyway is what makes hand-painted work look pasted on.
  if (uPaintOn > 0.5) {
    vec4 m = texture(uPaint, vUV);
    float desat = max(m.a - (m.r + m.g + m.b) * m.a, 0.0);
    float light = (m.r - m.g) * m.a;
    if (abs(light) > 0.002) {
      float room = light > 0.0 ? 1.0 - luma(c) : luma(c);
      c += light * room * 0.9;
    }
    float sat = m.b * m.a - desat;
    if (abs(sat) > 0.002) c = mix(vec3(luma(c)), c, 1.0 + sat);
  }

  // --- portrait ---
  // There is no face detector here. Skin sits in a narrow wedge of hue at
  // moderate saturation, and gating on that is both cheap and honest: it
  // treats a brick wall as skin now and then, and it never pretends to know
  // where anyone's eyes are.
  if (uPortrait.x > 0.001 || uPortrait.z > 0.001) {
    vec3 hsv = rgb2hsv(c);
    float hueFit = smoothstep(0.14, 0.05, abs(hsv.x - 0.06));
    float satFit = smoothstep(0.06, 0.18, hsv.y) * smoothstep(0.75, 0.45, hsv.y);
    float skin = hueFit * satFit * smoothstep(0.12, 0.3, hsv.z);

    // Smoothing works on the low-pass copy, then puts a fraction of the
    // texture back so a face keeps pores instead of turning to plastic.
    if (uPortrait.x > 0.001) {
      vec3 soft = blur + (sharp - blur) * 0.25;
      c = mix(c, soft, skin * uPortrait.x * 0.85);
    }

    // Eye clarity is local contrast held to the dark, detailed parts that
    // skin is not: lashes, pupils, the line of a brow.
    if (uPortrait.z > 0.001) {
      float detail = luma(sharp) - luma(blur);
      float dark = smoothstep(0.45, 0.1, luma(sharp));
      c += detail * uPortrait.z * 2.2 * dark * (1.0 - skin);
    }
  }

  // Spotlight: the opposite curve to the vignette, lifting the middle rather
  // than dropping the edges, which is what a reflector does in practice.
  if (uPortrait.y > 0.001) {
    vec2 pc = (vUV - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
    float lift = smoothstep(0.62, 0.0, length(pc) / 0.7071);
    c += lift * uPortrait.y * 0.16;
    c *= 1.0 - smoothstep(0.55, 1.0, length(pc) / 0.7071) * uPortrait.y * 0.22;
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

  // --- caption, over the picture but under the border ---
  if (uTextOpacity > 0.001) {
    vec4 t = texture(uText, vUV);
    c = mix(c, t.rgb, t.a * uTextOpacity);
  }

  // --- print border, last so grain and vignette do not crawl across it ---
  if (uBorder.x > 0.001) {
    vec2 px = min(vUV, 1.0 - vUV) * uResolution;
    float t = uBorder.x * 0.1 * min(uResolution.x, uResolution.y);
    // A pixel of softness on the inner edge: without it the border shimmers
    // whenever the preview is scaled by something that is not a whole ratio.
    float inside = smoothstep(t - 1.0, t + 1.0, min(px.x, px.y));
    c = mix(vec3(uBorder.y), c, inside);
  }

  fragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;
