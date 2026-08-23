/**
 * Runs the pipeline harness in headless Chrome.
 *
 *   node scripts/check-pipeline.js
 *
 * Where check-shaders.js proves the GLSL compiles, this proves it does the
 * job: that a crop changes the output size, that a dodging brush lightens
 * what it covers, that healing removes a blemish rather than moving it. The
 * renderer is bundled from source, so there is no second copy of the pipeline
 * to drift out of step with the one the browser loads.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const bundle = path.join(os.tmpdir(), `grainroom-harness-${Date.now()}.js`);

// Node refuses to spawn a .cmd shim directly since 24, so Windows goes
// through a shell. Quoting the paths matters there: this repository lives
// under a directory with spaces in its name.
const win = process.platform === "win32";
const quote = (s) => (win ? `"${s}"` : s);

execFileSync(
  win ? "npx.cmd" : "npx",
  [
    "--yes",
    "esbuild",
    quote(path.join(__dirname, "pipeline-harness.ts")),
    "--bundle",
    "--format=iife",
    "--global-name=harness",
    "--target=es2020",
    quote(`--outfile=${bundle}`),
  ],
  {
    cwd: root,
    shell: win,
    stdio: ["ignore", "ignore", "inherit"],
    timeout: 180_000,
  }
);

const CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

const browser = CANDIDATES.find((p) => fs.existsSync(p));
if (!browser) {
  console.error(
    "No Chrome or Edge found. Set CHROME_PATH to a Chromium binary and run again."
  );
  process.exit(1);
}

const page = `<!doctype html><meta charset="utf-8"><body><pre id="out">pending</pre>
<script>${fs.readFileSync(bundle, "utf8")}</script>
<script>
try {
  document.getElementById("out").textContent = harness.run();
} catch (e) {
  document.getElementById("out").textContent = "FAIL threw: " + (e && e.message);
}
</script></body>`;

const file = path.join(os.tmpdir(), `grainroom-pipeline-${Date.now()}.html`);
fs.writeFileSync(file, page, "utf8");

let dom;
try {
  dom = execFileSync(
    browser,
    [
      "--headless=new",
      "--disable-gpu",
      "--use-gl=swiftshader",
      "--enable-unsafe-swiftshader",
      "--no-sandbox",
      "--virtual-time-budget=20000",
      "--dump-dom",
      "file:///" + file.replace(/\\/g, "/"),
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 180_000 }
  );
} finally {
  fs.unlinkSync(file);
  fs.unlinkSync(bundle);
}

const body = dom.match(/<pre id="out">([\s\S]*?)<\/pre>/);
const report = body
  ? body[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
  : dom;

console.log(report.trim());
process.exit(/FAIL|pending/.test(report) ? 1 : 0);
