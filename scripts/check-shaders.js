/**
 * Compiles and links the GPU pipeline outside the browser UI.
 *
 *   node scripts/check-shaders.js
 *
 * GLSL is compiled at runtime, so a typo in a shader passes `tsc` and `next
 * build` and then breaks the editor for everyone at once. This drives a real
 * WebGL2 context in headless Chrome and fails loudly instead.
 *
 * The shader sources are read from src/lib/engine/shaders.ts through jiti, so
 * there is no second copy to drift out of step.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const jiti = require(path.join(root, "node_modules/jiti"))(__filename);
const { VERT, FRAG_ADJUST, FRAG_BLUR, FRAG_COMPOSITE } = jiti(
  path.join(root, "src/lib/engine/shaders.ts")
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

const programs = [
  { name: "adjust", vert: VERT, frag: FRAG_ADJUST },
  { name: "blur", vert: VERT, frag: FRAG_BLUR },
  { name: "composite", vert: VERT, frag: FRAG_COMPOSITE },
];

const page = `<!doctype html><meta charset="utf-8"><body><pre id="out">pending</pre>
<script>
const PROGRAMS = ${JSON.stringify(programs)};
const lines = [];
const gl = document.createElement("canvas").getContext("webgl2");
if (!gl) {
  lines.push("FAIL no webgl2 context");
} else {
  for (const p of PROGRAMS) {
    const stage = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        lines.push("FAIL " + p.name + " " +
          (type === gl.VERTEX_SHADER ? "vertex" : "fragment") + "\\n" +
          gl.getShaderInfoLog(sh));
        return null;
      }
      return sh;
    };
    const vs = stage(gl.VERTEX_SHADER, p.vert);
    const fs = stage(gl.FRAGMENT_SHADER, p.frag);
    if (!vs || !fs) continue;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, "aPos");
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      lines.push("FAIL " + p.name + " link\\n" + gl.getProgramInfoLog(prog));
      continue;
    }
    // A uniform the renderer sets but the linker dropped means the value is
    // silently going nowhere, which looks exactly like a tool doing nothing.
    const used = [];
    const count = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) used.push(gl.getActiveUniform(prog, i).name);
    lines.push("pass " + p.name + " [" + used.join(" ") + "]");
  }
}
document.getElementById("out").textContent = lines.join("\\n");
</script></body>`;

const file = path.join(os.tmpdir(), `grainroom-shader-check-${Date.now()}.html`);
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
      "--virtual-time-budget=4000",
      "--dump-dom",
      "file:///" + file.replace(/\\/g, "/"),
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 90_000 }
  );
} finally {
  fs.unlinkSync(file);
}

const body = dom.match(/<pre id="out">([\s\S]*?)<\/pre>/);
const report = body
  ? body[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
  : dom;

console.log(report.trim());
process.exit(/FAIL|pending/.test(report) ? 1 : 0);
