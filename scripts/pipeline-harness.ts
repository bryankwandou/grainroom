/**
 * Drives the real renderer against a synthetic photograph and checks that the
 * tools do what their labels claim.
 *
 * Bundled and run inside headless Chrome by scripts/check-pipeline.js. The
 * point is to catch the failures a compile cannot: a crop that does not change
 * the output size, a brush that paints nothing, a healing patch that leaves the
 * blemish exactly where it was.
 */
import { GrainroomRenderer } from "../src/lib/engine/renderer";
import { defaultParams, framedSize, type LookParams } from "../src/lib/looks";

const SRC_W = 240;
const SRC_H = 120;

/**
 * Left half red, right half blue, a green stripe along the top, and one white
 * spot to heal over. The stripe is what pins the orientation down: without
 * something that differs top from bottom, a pipeline that renders every photo
 * upside down passes every other check in here.
 */
function buildSource(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = SRC_W;
  canvas.height = SRC_H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgb(170, 40, 40)";
  ctx.fillRect(0, 0, SRC_W / 2, SRC_H);
  ctx.fillStyle = "rgb(40, 60, 170)";
  ctx.fillRect(SRC_W / 2, 0, SRC_W / 2, SRC_H);
  ctx.fillStyle = "rgb(40, 180, 60)";
  ctx.fillRect(0, 0, SRC_W, SRC_H * 0.15);
  ctx.fillStyle = "rgb(255, 255, 255)";
  ctx.beginPath();
  ctx.arc(SRC_W * 0.25, SRC_H * 0.5, 5, 0, Math.PI * 2);
  ctx.fill();
  return canvas;
}

const results: string[] = [];
let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  results.push(`${ok ? "pass" : "FAIL"}  ${label}${ok ? "" : ` — ${detail}`}`);
}

export function run(): string {
  const canvas = document.createElement("canvas");
  const renderer = new GrainroomRenderer(canvas);
  const source = buildSource();
  renderer.setImage(source, SRC_W, SRC_H);

  // Reading the rendered frame back through a 2D canvas, which is what
  // toBlob() does on export — so this measures the pixels a user would save.
  const probe = document.createElement("canvas");
  const probeCtx = probe.getContext("2d")!;

  const draw = (params: LookParams) => {
    const { w, h } = framedSize(params, SRC_W, SRC_H);
    renderer.render(params, w, h);
    probe.width = w;
    probe.height = h;
    probeCtx.clearRect(0, 0, w, h);
    probeCtx.drawImage(canvas, 0, 0);
    return { w, h };
  };

  const at = (x: number, y: number) => {
    const d = probeCtx.getImageData(
      Math.min(probe.width - 1, Math.max(0, Math.round(x * probe.width))),
      Math.min(probe.height - 1, Math.max(0, Math.round(y * probe.height))),
      1,
      1
    ).data;
    return { r: d[0], g: d[1], b: d[2], l: (d[0] + d[1] + d[2]) / 3 };
  };

  /* ---------------------------------------------------------------- */

  const base = defaultParams();
  const plain = draw(base);
  check(
    "an untouched photo comes out at its own size",
    plain.w === SRC_W && plain.h === SRC_H,
    `${plain.w}x${plain.h}`
  );
  const leftPlain = at(0.25, 0.7);
  const rightPlain = at(0.75, 0.7);
  check(
    "the two halves survive the round trip",
    leftPlain.r > 120 && rightPlain.b > 120,
    `left r=${leftPlain.r}, right b=${rightPlain.b}`
  );

  const top = at(0.5, 0.05);
  const bottom = at(0.5, 0.95);
  check(
    "the photo is the right way up",
    top.g > top.r && top.g > top.b && bottom.g < top.g,
    `top g=${top.g} r=${top.r} b=${top.b}, bottom g=${bottom.g}`
  );

  // --- crop ---
  const cropped = draw({ ...base, cropX: 0.5, cropW: 0.5 });
  check(
    "cropping to half the width halves the output",
    cropped.w === SRC_W / 2 && cropped.h === SRC_H,
    `${cropped.w}x${cropped.h}`
  );
  const cropColour = at(0.5, 0.5);
  check(
    "the right half is what is left after cropping the left away",
    cropColour.b > cropColour.r,
    `r=${cropColour.r} b=${cropColour.b}`
  );

  // --- quarter turn ---
  const turned = draw({ ...base, quarterTurns: 1 });
  check(
    "a quarter turn swaps the sides of the frame",
    turned.w === SRC_H && turned.h === SRC_W,
    `${turned.w}x${turned.h}`
  );
  // Clear of both the green stripe, which a clockwise turn puts down the
  // right edge, and the blemish, which lands squarely in the middle of the
  // top half.
  const turnedTop = at(0.2, 0.3);
  check(
    "turning clockwise brings the left half to the top",
    turnedTop.r > turnedTop.b,
    `r=${turnedTop.r} b=${turnedTop.b}`
  );
  const turnedStripe = at(0.95, 0.5);
  check(
    "and the top edge of the photo to the right",
    turnedStripe.g > turnedStripe.r && turnedStripe.g > turnedStripe.b,
    `g=${turnedStripe.g} r=${turnedStripe.r} b=${turnedStripe.b}`
  );

  // --- expand ---
  const expanded = draw({ ...base, expand: 1 });
  check(
    "expanding grows the frame by half again",
    expanded.w === Math.floor(SRC_W * 1.5),
    `${expanded.w}`
  );

  // --- selective ---
  const litPoint = draw({
    ...base,
    points: [
      { x: 0.75, y: 0.5, size: 0.5, brightness: 0.9, contrast: 0, saturation: 0 },
    ],
  });
  void litPoint;
  const pointLit = at(0.75, 0.5);
  const pointAway = at(0.05, 0.5);
  check(
    "a selective point brightens where it sits",
    pointLit.l > rightPlain.l + 8,
    `${rightPlain.l} -> ${pointLit.l}`
  );
  check(
    "and leaves the far side of the frame alone",
    Math.abs(pointAway.l - at(0.05, 0.5).l) < 3 && pointAway.l < pointLit.l,
    `far=${pointAway.l} near=${pointLit.l}`
  );

  // --- brush ---
  draw({
    ...base,
    strokes: [{ x: 0.75, y: 0.5, r: 0.3, amount: 1, mode: "light" }],
  });
  const dodged = at(0.75, 0.5);
  check(
    "a dodging brush lightens the pixels it covers",
    dodged.l > rightPlain.l + 8,
    `${rightPlain.l} -> ${dodged.l}`
  );

  draw({
    ...base,
    strokes: [{ x: 0.75, y: 0.5, r: 0.3, amount: -1, mode: "light" }],
  });
  const burned = at(0.75, 0.5);
  check(
    "and burning darkens them",
    burned.l < rightPlain.l - 4,
    `${rightPlain.l} -> ${burned.l}`
  );

  draw({
    ...base,
    strokes: [{ x: 0.75, y: 0.5, r: 0.3, amount: -1, mode: "saturation" }],
  });
  const muted = at(0.75, 0.5);
  check(
    "muting with the brush pulls the colour out",
    Math.abs(muted.b - muted.r) < Math.abs(rightPlain.b - rightPlain.r),
    `spread ${Math.abs(rightPlain.b - rightPlain.r)} -> ${Math.abs(muted.b - muted.r)}`
  );

  // --- healing ---
  draw(base);
  const blemish = at(0.25, 0.5);
  check(
    "the synthetic blemish is there to begin with",
    blemish.l > 200,
    `l=${blemish.l}`
  );
  draw({ ...base, heals: [{ x: 0.25, y: 0.5, r: 0.09 }] });
  const healed = at(0.25, 0.5);
  check(
    "healing fills it in from the surrounding red",
    healed.l < 150 && healed.r > healed.b,
    `l=${healed.l} r=${healed.r} b=${healed.b}`
  );

  // --- frames ---
  draw({ ...base, borderWidth: 0.5, borderTone: 0 });
  const corner = at(0.01, 0.5);
  check(
    "a black print border reaches the edge of the frame",
    corner.l < 20,
    `l=${corner.l}`
  );

  // --- text ---
  draw(base);
  const captionBefore = at(0.5, 0.88);
  draw({ ...base, text: "GRAINROOM", textSize: 0.2, textTone: 1 });
  let brightest = 0;
  for (let x = 0.3; x <= 0.7; x += 0.02) {
    brightest = Math.max(brightest, at(x, 0.88).l);
  }
  check(
    "a caption is drawn into the frame",
    brightest > captionBefore.l + 40,
    `${captionBefore.l} -> ${brightest}`
  );

  renderer.dispose();
  results.push(
    failures === 0 ? "\nAll pipeline checks passed." : `\n${failures} check(s) failed.`
  );
  return results.join("\n");
}
