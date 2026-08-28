/**
 * Renders the video's still frames with the real editor, in headless Chrome.
 *
 *   node scripts/render-frames.js
 *
 * Writes public/frames/<id>.png, one per shot in frame-harness.ts. The video
 * composites these; it never draws a fake screenshot of the product.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "public", "frames");
fs.mkdirSync(outDir, { recursive: true });

const bundle = path.join(os.tmpdir(), `grainroom-frames-${Date.now()}.js`);

// esbuild's own API rather than its command line: this project sits under a
// path with spaces in it, and handing that to a shell on Windows splits the
// command itself in two.
require("esbuild").buildSync({
  entryPoints: [path.join(__dirname, "frame-harness.ts")],
  bundle: true,
  format: "iife",
  globalName: "frames",
  target: "es2020",
  outfile: bundle,
  logLevel: "error",
});

const CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

const browser = CANDIDATES.find((p) => fs.existsSync(p));
if (!browser) {
  console.error("No Chrome or Edge found. Set CHROME_PATH and run again.");
  process.exit(1);
}

const harness = fs.readFileSync(bundle, "utf8");

/** Runs a page in the browser and hands back whatever it put in the title. */
function ask(html, args = []) {
  const file = path.join(os.tmpdir(), `grainroom-ask-${Date.now()}.html`);
  fs.writeFileSync(file, html, "utf8");
  try {
    const dom = execFileSync(
      browser,
      [
        "--headless=new",
        "--disable-gpu",
        "--use-gl=swiftshader",
        "--enable-unsafe-swiftshader",
        "--no-sandbox",
        "--hide-scrollbars",
        "--virtual-time-budget=8000",
        ...args,
        "file:///" + file.replace(/\\/g, "/"),
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 120_000 }
    );
    return dom;
  } finally {
    fs.unlinkSync(file);
  }
}

// Ask the harness what shape each shot is before capturing any of them.
const sizeDom = ask(
  `<!doctype html><meta charset="utf-8"><body><pre id="out"></pre>
   <canvas id="stage"></canvas>
   <script>${harness}</script>
   <script>document.getElementById("out").textContent = frames.sizes();</script>
   </body>`,
  ["--dump-dom"]
);

const sizeMatch = sizeDom.match(/<pre id="out">([\s\S]*?)<\/pre>/);
if (!sizeMatch) {
  console.error("The harness did not report frame sizes.");
  process.exit(1);
}
const shots = JSON.parse(
  sizeMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&")
);
const count = shots.length;

// The canvas is pinned to the window rather than fitted inside it, so the
// capture is the picture and nothing else — no margin to trim later.
const page = (index) => `<!doctype html><meta charset="utf-8">
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: #100f0d; }
  canvas { display: block; width: 100vw; height: 100vh; }
</style>
<body><canvas id="stage"></canvas>
<script>${harness}</script>
<script>document.title = frames.shoot(${index});</script>
</body>`;

console.log(`Shooting ${count} frames with the editor's own renderer.\n`);

shots.forEach((shot, i) => {
  const file = path.join(os.tmpdir(), `grainroom-shot-${i}-${Date.now()}.html`);
  fs.writeFileSync(file, page(i), "utf8");
  const target = path.join(outDir, `${i}.png`);

  try {
    execFileSync(
      browser,
      [
        "--headless=new",
        "--disable-gpu",
        "--use-gl=swiftshader",
        "--enable-unsafe-swiftshader",
        "--no-sandbox",
        "--hide-scrollbars",
        "--force-device-scale-factor=1",
        `--window-size=${shot.w},${shot.h}`,
        "--virtual-time-budget=8000",
        `--screenshot=${target}`,
        "file:///" + file.replace(/\\/g, "/"),
      ],
      { stdio: ["ignore", "ignore", "ignore"], timeout: 120_000 }
    );
  } finally {
    fs.unlinkSync(file);
  }

  const size = fs.existsSync(target) ? fs.statSync(target).size : 0;
  console.log(
    `  ${size > 5000 ? "ok  " : "FAIL"} frames/${i}.png  ${shot.id}  ` +
      `${shot.w}x${shot.h}  ${(size / 1024).toFixed(0)} kB`
  );
  if (size <= 5000) process.exitCode = 1;
});

fs.unlinkSync(bundle);
console.log("\nFrames written to public/frames.");
