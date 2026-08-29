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
      [...document.querySelectorAll(sel)].find(
        (el) => el.textContent.trim() === t
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

  // Anything the page sends to another host would show up here. The editor is
  // supposed to send nothing at all.
  const offsite = [];
  page.on("request", (r) => {
    const url = r.url();
    if (!url.startsWith(BASE) && !url.startsWith("data:") && !url.startsWith("blob:")) {
      offsite.push(`${r.method()} ${url}`);
    }
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
    await input.uploadFile(PHOTO);
    const decoded = await until(page, () =>
      /1500\s*×\s*938/.test(document.body.innerText)
    );
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

    /* ------------------------- the promise ------------------------- */
    check(
      "nothing was sent to another host",
      offsite.length === 0,
      offsite.slice(0, 3).join(" / ")
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
