/**
 * Drives the running application in a real browser and checks that the editor
 * does what its interface says it does.
 *
 *   npm run dev            # in one terminal
 *   npm run check:app      # in another
 *
 * check:shaders proves the GPU programs compile. check:pipeline proves the
 * renderer produces the right pixels. Neither of them opens the app: a broken
 * file input, a panel that never mounts, or an export button wired to nothing
 * would pass both and still leave nobody able to edit a photograph. This is
 * the one that clicks.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const puppeteer = require("puppeteer-core");

const BASE = process.env.BASE || "http://localhost:3000";
const root = path.join(__dirname, "..");
const outDir = path.join(root, ".e2e");
const shotDir = path.join(outDir, "shots");
const dlDir = path.join(outDir, "downloads");

for (const d of [outDir, shotDir, dlDir]) fs.mkdirSync(d, { recursive: true });
for (const f of fs.readdirSync(dlDir)) fs.unlinkSync(path.join(dlDir, f));

const CHROME = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]
  .filter(Boolean)
  .find((p) => fs.existsSync(p));

if (!CHROME) {
  console.error("No Chrome or Edge found. Set CHROME_PATH.");
  process.exit(1);
}

/** A photograph to edit. The video's frames are the handiest real image. */
const PHOTO = [
  path.join(root, "video/public/frames/0.png"),
  path.join(root, "video/public/frames/1.png"),
].find((p) => fs.existsSync(p));

/** A different frame, so a double exposure has two things to combine. */
const PHOTO2 = [
  path.join(root, "video/public/frames/7.png"),
  path.join(root, "video/public/frames/2.png"),
].find((p) => fs.existsSync(p));

if (!PHOTO) {
  console.error(
    "No test photograph. Run: npm --prefix video install && npm --prefix video run frames"
  );
  process.exit(1);
}

/** The synthetic sensor file, built on demand rather than committed. */
const DNG = path.join(outDir, "test.dng");

let failures = 0;
const results = [];

function check(label, ok, detail = "") {
  if (!ok) failures++;
  const line = `${ok ? "pass" : "FAIL"}  ${label}${ok ? "" : `  — ${detail}`}`;
  results.push(line);
  console.log(line);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A coarse fingerprint of what is on the canvas.
 *
 * Scaled to 12x12 and compared channel by channel, so it survives grain and
 * antialiasing but moves the moment a tool actually changes the picture.
 */
async function signature(page) {
  return page.evaluate(() => {
    const c = document.querySelector("main canvas");
    if (!c) return null;
    const s = document.createElement("canvas");
    s.width = 12;
    s.height = 12;
    const ctx = s.getContext("2d");
    ctx.drawImage(c, 0, 0, 12, 12);
    return Array.from(ctx.getImageData(0, 0, 12, 12).data);
  });
}

function distance(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

/**
 * Waits for a condition in the page rather than for a number of seconds.
 *
 * Fixed delays are the reason browser suites get a reputation for lying: on a
 * loaded machine a three second wait for a photograph to decode is sometimes
 * four, and everything after it fails for reasons that have nothing to do
 * with the code under test.
 */
async function until(page, fn, { timeout = 25_000, step = 300 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await page.evaluate(fn)) return true;
    if (Date.now() > deadline) return false;
    await wait(step);
  }
}

/** Clicks a control by the words a person would read on it. */
async function clickText(page, text, selector = "button") {
  const handle = await page.evaluateHandle(
    (sel, t) =>
      // Case-insensitive: the panel tabs are written in lower case and
      // capitalised by a stylesheet, so what a person reads as "Chain" is
      // "chain" in the DOM.
      [...document.querySelectorAll(sel)].find(
        (el) => el.textContent.trim().toLowerCase() === t.toLowerCase()
      ) || null,
    selector,
    text
  );
  const el = handle.asElement();
  if (!el) throw new Error(`no ${selector} reading "${text}"`);
  await el.click();
  await wait(250);
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: [
      "--no-sandbox",
      "--use-gl=swiftshader",
      "--enable-unsafe-swiftshader",
      "--window-size=1600,1000",
    ],
    defaultViewport: { width: 1600, height: 1000 },
  });

  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  // What the promise actually is: the photograph never leaves the machine.
  // It is not that the page never touches the network — asking devnet whether
  // a Look has been claimed is a lookup of a 64-character hash, and refusing
  // to record that distinction would make this check either a lie or useless.
  // So every off-origin request is recorded with the size of what it carried.
  const offsite = [];
  const RPC = /(^|\.)solana\.com$/;
  // The subject model's weights are 221 MB, which is too much to serve from
  // this origin, so they come from the vendor's CDN the first time Cut Out is
  // used and are cached by the browser after that. This is an allowance for
  // a download, not for an upload: what may not happen is the photograph
  // going anywhere, and that is checked separately and strictly below.
  const MODEL_CDN = /(^|\.)staticimgly\.com$/;
  page.on("request", (r) => {
    const url = r.url();
    if (url.startsWith(BASE) || url.startsWith("data:") || url.startsWith("blob:")) {
      return;
    }
    let host = "";
    try {
      host = new URL(url).hostname;
    } catch {
      host = url;
    }
    const body = r.postData() || "";
    offsite.push({
      host,
      method: r.method(),
      bytes: body.length,
      looksLikeAnImage:
        /data:image|"image\/|iVBORw0KGgo|\/9j\/4AAQ/.test(body),
      allowed: RPC.test(host) || MODEL_CDN.test(host),
    });
  });

  const cdp = await page.createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: dlDir,
    eventsEnabled: true,
  });

  try {
    /* ------------------------- landing ------------------------- */
    // Not networkidle: a dev server holds a hot-reload socket open, so the
    // network never goes quiet and the wait times out on a page that has in
    // fact been ready for a minute.
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForSelector("canvas", { timeout: 60_000 });
    await wait(2500);
    await page.screenshot({ path: path.join(shotDir, "01-landing.png") });

    const title = await page.title();
    check("the landing page answers", /grainroom/i.test(title), title);

    // Ports get reused. Another project's dev server answering here would
    // otherwise fail every check below with a different symptom each time,
    // and the run would read like the editor was broken.
    if (!/grainroom/i.test(title)) {
      console.error(
        `\n${BASE} is serving something else ("${title}").\n` +
          "Start this project's server and point the check at it:\n" +
          "  npx next dev -p 4310\n" +
          "  BASE=http://localhost:4310 npm run check:app\n"
      );
      throw new Error("wrong application on " + BASE);
    }

    // The hero paints on an animation frame after mount, and how long that
    // takes depends on the machine. Polling for it beats guessing a delay
    // that is either flaky or slow.
    const readHero = () =>
      page.evaluate(() => {
        const c = document.querySelector("canvas");
        if (!c) return "no canvas";
        const s = document.createElement("canvas");
        s.width = 8;
        s.height = 8;
        const ctx = s.getContext("2d");
        ctx.drawImage(c, 0, 0, 8, 8);
        const d = ctx.getImageData(0, 0, 8, 8).data;
        const first = [d[0], d[1], d[2]].join();
        for (let i = 4; i < d.length; i += 4) {
          if ([d[i], d[i + 1], d[i + 2]].join() !== first) return "varied";
        }
        return "flat";
      });

    let hero = await readHero();
    for (let i = 0; i < 20 && hero !== "varied"; i++) {
      await wait(500);
      hero = await readHero();
    }
    check("the hero runs the pipeline rather than showing a blank canvas", hero === "varied", hero);

    /* ------------------------- editor ------------------------- */
    await page.goto(`${BASE}/edit`, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    await page.waitForSelector('input[type="file"]', { timeout: 60_000 });
    await wait(1500);
    await page.screenshot({ path: path.join(shotDir, "02-editor-empty.png") });

    const invites = await page.evaluate(() =>
      /photo|drop|open/i.test(document.body.innerText)
    );
    check("the editor invites a photograph", invites);

    const input = await page.$('input[type="file"]');
    check("there is a file input to load one with", Boolean(input));

    // The markup arrives before React attaches to it. Handing a file to an
    // input whose onChange is not wired yet does nothing at all, silently,
    // and every check after it then fails for a reason that has nothing to
    // do with the tool it names. Waiting for the canvas to exist is the
    // cheapest evidence that the editor is actually running.
    await page.waitForSelector("main canvas", { timeout: 60_000 });
    await wait(1200);

    // A second attempt costs a few seconds and covers the case where the
    // first one landed a moment too early on a cold dev server.
    let decoded = false;
    for (let attempt = 0; attempt < 2 && !decoded; attempt++) {
      await input.uploadFile(PHOTO);
      decoded = await until(
        page,
        () => /1500\s*×\s*938/.test(document.body.innerText),
        { timeout: 30_000 }
      );
    }
    await wait(700);
    await page.screenshot({ path: path.join(shotDir, "03-loaded.png") });

    const text = await page.evaluate(() => document.body.innerText);
    check(
      "the photograph's own dimensions are reported",
      decoded,
      text.slice(0, 140).replace(/\n/g, " | ")
    );

    // A canvas exists before any photograph does, so "a canvas is present" is
    // not evidence of anything. This asks whether it has more than one colour.
    const loaded = await signature(page);
    const varied =
      Boolean(loaded) &&
      loaded.some((v, i) => i % 4 !== 3 && v !== loaded[i % 4]);
    check("the photograph reaches the canvas", varied);

    /* --------------------- a tool does something --------------------- */
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('input[type="range"]')].find(
        (i) => i.getAttribute("aria-label") === "Exposure"
      );
      if (!el) throw new Error("no Exposure slider");
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      ).set;
      setter.call(el, "0.9");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await wait(900);
    const brightened = await signature(page);
    check(
      "moving Exposure changes the picture on screen",
      distance(loaded, brightened) > 4,
      `moved ${distance(loaded, brightened).toFixed(1)}`
    );
    await page.screenshot({ path: path.join(shotDir, "04-exposure.png") });

    await page.keyboard.down("Control");
    await page.keyboard.press("KeyZ");
    await page.keyboard.up("Control");
    await wait(900);
    const undone = await signature(page);
    check(
      "undo puts the photograph back",
      distance(loaded, undone) < 3,
      `still ${distance(loaded, undone).toFixed(1)} away`
    );

    /* ------------------------- geometry ------------------------- */
    await clickText(page, "Crop & Rotate");
    await wait(500);
    await clickText(page, "1:1");
    await until(page, () => {
      const c = document.querySelector("main canvas");
      return c ? Math.abs(c.clientWidth / c.clientHeight - 1) < 0.06 : false;
    });
    await wait(400);
    await page.screenshot({ path: path.join(shotDir, "05-cropped.png") });

    const shape = await page.evaluate(() => {
      const c = document.querySelector("main canvas");
      return c ? c.clientWidth / c.clientHeight : 0;
    });
    check(
      "a square crop makes the frame square",
      Math.abs(shape - 1) < 0.06,
      `aspect ${shape.toFixed(3)}`
    );

    const framed = await page.evaluate(() => document.body.innerText);
    check(
      "the header reports the new output size",
      /→\s*\d+\s*×\s*\d+/.test(framed),
      "no framed size shown"
    );

    // Back to the whole frame before the painted tools, so their marks are
    // checked against the picture rather than a corner of it.
    await clickText(page, "Back to the full frame");
    await wait(900);

    /* ------------------------- selective ------------------------- */
    await clickText(page, "Selective");
    await wait(500);
    const box = await page.evaluate(() => {
      const c = document.querySelector("main canvas");
      const r = c.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    await page.mouse.click(box.x + box.w * 0.5, box.y + box.h * 0.5);
    await until(page, () => /point 1/i.test(document.body.innerText));
    await wait(400);
    await page.screenshot({ path: path.join(shotDir, "06-selective.png") });

    const placed = await page.evaluate(() =>
      /point 1/i.test(document.body.innerText)
    );
    check("tapping the photograph leaves a selective point", placed);

    /* ------------------------- brush ------------------------- */
    await clickText(page, "Brush");
    await wait(500);
    await page.mouse.move(box.x + box.w * 0.25, box.y + box.h * 0.62);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(
        box.x + box.w * (0.25 + i * 0.045),
        box.y + box.h * 0.62
      );
      await wait(45);
    }
    await page.mouse.up();
    await until(page, () => {
      const m = document.body.innerText.match(/(\d+)\s+of\s+96\s+marks/i);
      return m ? Number(m[1]) > 1 : false;
    });
    await wait(400);
    await page.screenshot({ path: path.join(shotDir, "07-brush.png") });

    const marks = await page.evaluate(() => {
      const m = document.body.innerText.match(/(\d+)\s+of\s+96\s+marks/i);
      return m ? Number(m[1]) : 0;
    });
    check("dragging across the photograph paints", marks > 1, `${marks} marks`);

    /* --------------------- double exposure --------------------- */
    await clickText(page, "Double Exposure");
    await wait(500);
    const beforeBlend = await signature(page);

    // The second frame goes in through its own input, so choosing one can
    // never replace the photograph being edited.
    const second = await page.$('input[aria-label="Second photograph"]');
    check("there is a separate input for the second frame", Boolean(second));
    await second.uploadFile(PHOTO2 || PHOTO);
    // The second frame has to decode before it can appear, and the mode is
    // switched on for the first one automatically.
    await until(page, () => /screen/i.test(document.body.innerText));
    await wait(1500);
    await page.screenshot({ path: path.join(shotDir, "08-double.png") });

    const afterBlend = await signature(page);
    check(
      "a second photograph lands on the first",
      distance(beforeBlend, afterBlend) > 3,
      `moved ${distance(beforeBlend, afterBlend).toFixed(1)}`
    );

    await clickText(page, "Multiply");
    await wait(900);
    const multiplied = await signature(page);
    check(
      "changing the blend mode changes the result",
      distance(afterBlend, multiplied) > 3,
      `moved ${distance(afterBlend, multiplied).toFixed(1)}`
    );

    await clickText(page, "Remove");
    await wait(900);
    const removed = await signature(page);
    check(
      "removing the second photograph puts the first one back",
      distance(beforeBlend, removed) < 3,
      `still ${distance(beforeBlend, removed).toFixed(1)} away`
    );

    /* ------------------------- cut out ------------------------- */
    // The model runs on this machine. First use downloads weights, which is
    // slow in a cold browser profile, so this waits minutes rather than
    // seconds before deciding it has failed.
    await clickText(page, "Cut Out");
    await wait(500);
    const beforeCut = await signature(page);

    await clickText(page, "Find the subject");
    const found = await until(
      page,
      () => {
        const t = document.body.innerText;
        return /Find the subject again/.test(t) || /could not/i.test(t);
      },
      { timeout: 240_000, step: 1000 }
    );
    const cutFailed = await page.evaluate(() =>
      /could not|model could not/i.test(document.body.innerText)
    );
    check(
      "the subject is found on this machine",
      found && !cutFailed,
      cutFailed ? "the editor reported it could not" : "timed out"
    );

    if (found && !cutFailed) {
      await wait(1500);

      // Soften is the default because it is the one people want, but it is a
      // poor thing to assert on: blurring a smooth sky changes almost nothing,
      // and the check would be measuring the photograph rather than the tool.
      // Darken cannot be subtle.
      await clickText(page, "Darken");
      await wait(1200);
      const darkened = await signature(page);
      check(
        "separating the subject changes the background",
        distance(beforeCut, darkened) > 1.5,
        `moved ${distance(beforeCut, darkened).toFixed(1)}`
      );

      await clickText(page, "Mute");
      await wait(1000);
      const muted = await signature(page);
      check(
        "a different background treatment gives a different result",
        distance(darkened, muted) > 1.5,
        `moved ${distance(darkened, muted).toFixed(1)}`
      );
      await page.screenshot({ path: path.join(shotDir, "09-cutout.png") });

      await clickText(page, "Forget");
      await wait(900);
    }

    /* ------------------- every remaining tool ------------------- */
    // One pass over the tools that work by moving a slider. Each one has to
    // change the picture: a tool that mounts, accepts input and renders
    // nothing is the failure this catches, and it is invisible to a
    // typechecker because every part of it is individually correct.
    const SWEEP = [
      "White Balance",
      "Details",
      "Dehaze",
      "Lens Blur",
      "Tonality",
      "Grain",
      "Glow",
      "Split Tone",
      "Expand",
      "Portrait",
      "Frames",
      "Perspective",
    ];

    for (const name of SWEEP) {
      await clickText(page, name);
      await wait(350);
      const before = await signature(page);

      // Push every slider in the open panel well off its neutral, the way a
      // person testing a tool would rather than nudging it.
      const moved = await page.evaluate(() => {
        const panel = document.querySelector("aside") || document.body;
        const sliders = [...panel.querySelectorAll('input[type="range"]')];
        if (!sliders.length) return 0;
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value"
        ).set;
        for (const el of sliders) {
          const min = Number(el.min || 0);
          const max = Number(el.max || 1);
          setter.call(el, String(min + (max - min) * 0.85));
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
        return sliders.length;
      });

      await wait(900);
      const after = await signature(page);
      check(
        `${name} changes the picture`,
        moved > 0 && distance(before, after) > 1.5,
        moved === 0
          ? "no sliders in the panel"
          : `${moved} sliders, moved ${distance(before, after).toFixed(1)}`
      );
    }

    // Colour HSL works on one band of hue at a time, so pushing whichever
    // band happens to be selected proves nothing about a photograph that has
    // little of that colour in it. Each band gets a turn.
    await clickText(page, "Colour HSL");
    await wait(400);
    let bestBand = 0;
    let bandName = "";
    for (const band of ["Red", "Orange", "Yellow", "Green", "Blue"]) {
      const picked = await page.evaluate((b) => {
        const el = [...document.querySelectorAll("button")].find(
          (x) => x.textContent.trim() === b
        );
        if (!el) return false;
        el.click();
        return true;
      }, band);
      if (!picked) continue;
      await wait(300);
      const before = await signature(page);
      await page.evaluate(() => {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value"
        ).set;
        for (const el of document.querySelectorAll(
          'aside input[type="range"]'
        )) {
          const min = Number(el.min || 0);
          const max = Number(el.max || 1);
          setter.call(el, String(min + (max - min) * 0.9));
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
      await wait(800);
      const moved = distance(before, await signature(page));
      if (moved > bestBand) {
        bestBand = moved;
        bandName = band;
      }
    }
    check(
      "Colour HSL changes the picture, in whichever band the photo has",
      bestBand > 1.5,
      `best was ${bandName || "none"} at ${bestBand.toFixed(1)}`
    );

    await page.screenshot({ path: path.join(shotDir, "10-swept.png") });

    /* ------------------------- black and white ------------------------- */
    await clickText(page, "Black & White");
    await wait(400);
    const beforeBW = await signature(page);
    // The filter presets are deliberately disabled until the conversion is
    // switched on — a colour filter over colour film means nothing — so the
    // checkbox goes first.
    const bwOn = await page.evaluate(() => {
      const box = document.querySelector('aside input[type="checkbox"]');
      if (!box) return false;
      box.click();
      return true;
    });
    await wait(700);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find(
        (el) => el.textContent.trim() === "Red filter"
      );
      if (b) b.click();
    });
    await wait(900);
    const afterBW = await signature(page);
    check(
      "Black & White drains the colour",
      bwOn && distance(beforeBW, afterBW) > 1.5,
      bwOn ? `moved ${distance(beforeBW, afterBW).toFixed(1)}` : "no filter button"
    );

    /* ------------------------- a caption ------------------------- */
    await clickText(page, "Text");
    await wait(400);
    const beforeText = await signature(page);
    const typed = await page.evaluate(() => {
      const t = document.querySelector("textarea");
      if (!t) return false;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value"
      ).set;
      setter.call(t, "PROOF");
      t.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    });
    await wait(1200);
    const afterText = await signature(page);
    check(
      "a caption is drawn onto the photograph",
      typed && distance(beforeText, afterText) > 0.8,
      typed ? `moved ${distance(beforeText, afterText).toFixed(1)}` : "no textarea"
    );

    /* ------------------------- the ledger ------------------------- */
    // The chain side has to work from the interface, not only from a script.
    await clickText(page, "Chain");
    const hashed = await until(
      page,
      () => /[0-9a-f]{8}/.test(document.body.innerText),
      { timeout: 30_000 }
    );
    check("the Look is hashed for publishing", hashed);

    const registry = await until(
      page,
      () =>
        !/Checking the registry program/i.test(document.body.innerText),
      { timeout: 40_000 }
    );
    const chainText = await page.evaluate(() => document.body.innerText);
    check(
      "the registry program on devnet is reached",
      registry && !/not yet live|not answering/i.test(chainText),
      chainText.slice(0, 160),
    );
    await page.screenshot({ path: path.join(shotDir, "11-chain.png") });

    /* ------------------------- export ------------------------- */
    await clickText(page, "Export");
    await wait(800);
    await clickText(page, "Save to device");
    await wait(8000);

    const files = fs.readdirSync(dlDir).filter((f) => !f.endsWith(".crdownload"));
    const size = files.length ? fs.statSync(path.join(dlDir, files[0])).size : 0;
    check(
      "Save to device writes a real file",
      files.length > 0 && size > 20_000,
      `${files.length} file(s), ${(size / 1024).toFixed(0)} kB`
    );
    await page.screenshot({ path: path.join(shotDir, "09-export.png") });

    /* --------------------- a raw file --------------------- */
    // Last, because opening one replaces the photograph everything above was
    // working on. The file is generated rather than committed: camera files
    // are large and belong to whoever pressed the shutter, and a synthetic
    // sensor has the advantage that the right answer is known in advance —
    // red photosites bright on the left, blue bright on the right.
    if (!fs.existsSync(DNG)) {
      execFileSync(process.execPath, [path.join(__dirname, "make-test-dng.js"), DNG], {
        stdio: "ignore",
      });
    }

    // A Look deliberately outlives the photograph it was built on — that is
    // how one recipe gets applied across a set of frames. It means the RAW
    // file would arrive wearing everything above it, including the black and
    // white conversion, which would make any statement about colour a
    // statement about the previous forty checks. So: a clean editor.
    await page.goto(`${BASE}/edit`, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    await page.waitForSelector("main canvas", { timeout: 60_000 });
    await wait(1500);

    const rawInput = await page.$('input[type="file"]');
    await rawInput.uploadFile(DNG);
    const developed = await until(
      page,
      () => /64\s*×\s*48/.test(document.body.innerText),
      { timeout: 120_000, step: 1000 }
    );
    check(
      "a RAW file is developed and opened",
      developed,
      (await page.evaluate(() => document.body.innerText)).slice(0, 120)
    );

    if (developed) {
      await wait(1200);
      await page.screenshot({ path: path.join(shotDir, "12-raw.png") });
      const halves = await page.evaluate(() => {
        const el = document.querySelector("main canvas");
        const s = document.createElement("canvas");
        s.width = 64;
        s.height = 48;
        const ctx = s.getContext("2d");
        ctx.drawImage(el, 0, 0, 64, 48);
        const read = (x) => {
          const d = ctx.getImageData(x, 8, 16, 32).data;
          let r = 0, b = 0;
          for (let i = 0; i < d.length; i += 4) {
            r += d[i];
            b += d[i + 2];
          }
          const n = d.length / 4;
          return { r: r / n, b: b / n };
        };
        return { left: read(8), right: read(40) };
      });

      check(
        "the demosaic put the colours where the sensor recorded them",
        halves.left.r > halves.left.b && halves.right.b > halves.right.r,
        `left r=${halves.left.r.toFixed(0)} b=${halves.left.b.toFixed(0)}, ` +
          `right r=${halves.right.r.toFixed(0)} b=${halves.right.b.toFixed(0)}`
      );
    }

    /* ------------------------- the promise ------------------------- */
    const strangers = offsite.filter((r) => !r.allowed);
    check(
      "the only other hosts are the ledger and the model download",
      strangers.length === 0,
      strangers.map((r) => `${r.method} ${r.host}`).slice(0, 3).join(" / ")
    );

    const carriedPixels = offsite.filter(
      (r) => r.looksLikeAnImage || r.bytes > 8192
    );
    check(
      "the photograph never left the machine",
      carriedPixels.length === 0,
      carriedPixels
        .map((r) => `${r.host} carried ${r.bytes} bytes`)
        .slice(0, 3)
        .join(" / ")
    );

    const rpc = offsite.filter((r) => r.allowed);
    console.log(
      `      (${rpc.length} devnet lookups, largest ${Math.max(
        0,
        ...rpc.map((r) => r.bytes)
      )} bytes — a Look hash, not a picture)`
    );
    check(
      "the browser logged no errors while all that happened",
      consoleErrors.length === 0,
      consoleErrors.slice(0, 2).join(" / ")
    );
  } catch (err) {
    check("the run completed without throwing", false, String(err.message || err));
    await page
      .screenshot({ path: path.join(shotDir, "99-threw.png") })
      .catch(() => undefined);
  } finally {
    await browser.close();
  }

  console.log(
    failures === 0
      ? `\nAll ${results.length} checks passed. Screenshots in .e2e/shots.`
      : `\n${failures} of ${results.length} checks failed. Screenshots in .e2e/shots.`
  );
  process.exit(failures === 0 ? 0 : 1);
})();
