/**
 * The scene the demos are shot on.
 *
 * Painting a landscape rather than bundling a photograph keeps the repository
 * free of anyone else's picture, and means the hero, the marketing frames and
 * the render tests are all looking at exactly the same pixels.
 */

/**
 * Fixed sequence for the broken reflection on the water.
 *
 * Math.random would repaint the sparkle differently on every call, which is
 * invisible on the site and ruins a before-and-after pair: the two frames
 * would differ in a way that has nothing to do with the edit between them.
 */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function paintScene(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;

  // Sky, dusk falling from the top
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.72);
  sky.addColorStop(0, "#1b3a5c");
  sky.addColorStop(0.45, "#5b7f96");
  sky.addColorStop(0.78, "#c9a274");
  sky.addColorStop(1, "#e8c58f");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // Low sun, with a soft bloom around it
  const sunX = w * 0.68;
  const sunY = h * 0.6;
  const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, w * 0.34);
  glow.addColorStop(0, "rgba(255,236,190,0.95)");
  glow.addColorStop(0.25, "rgba(255,196,120,0.45)");
  glow.addColorStop(1, "rgba(255,180,100,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  ctx.beginPath();
  ctx.arc(sunX, sunY, w * 0.028, 0, Math.PI * 2);
  ctx.fillStyle = "#fff6dd";
  ctx.fill();

  // Ridgelines, each one hazier and lighter than the one in front
  const ridges = [
    { y: 0.62, amp: 0.045, colour: "#6d7f88", freq: 2.1 },
    { y: 0.7, amp: 0.06, colour: "#4d5c66", freq: 1.5 },
    { y: 0.79, amp: 0.05, colour: "#2f3a44", freq: 2.7 },
    { y: 0.88, amp: 0.04, colour: "#1a2128", freq: 3.4 },
  ];

  ridges.forEach((r, i) => {
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += 3) {
      const t = x / w;
      const y =
        h * r.y -
        Math.sin(t * Math.PI * r.freq + i * 1.7) * h * r.amp -
        Math.sin(t * Math.PI * r.freq * 3.1 + i) * h * r.amp * 0.3;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = r.colour;
    ctx.fill();
  });

  // Water, mirroring the sun with a broken reflection
  const water = ctx.createLinearGradient(0, h * 0.88, 0, h);
  water.addColorStop(0, "#141b21");
  water.addColorStop(1, "#232e37");
  ctx.fillStyle = water;
  ctx.fillRect(0, h * 0.88, w, h * 0.12);

  ctx.globalAlpha = 0.5;
  const rand = seeded(20260824);
  for (let i = 0; i < 40; i++) {
    const y = h * 0.885 + rand() * h * 0.11;
    const len = (rand() * w) / 14;
    ctx.fillStyle = `rgba(255,205,140,${0.06 + rand() * 0.18})`;
    ctx.fillRect(sunX - len / 2 + (rand() - 0.5) * w * 0.1, y, len, 1.4);
  }
  ctx.globalAlpha = 1;

  return c;
}
