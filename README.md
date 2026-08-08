<div align="center">

<img src="public/icon.svg" width="72" alt="Grainroom">

# Grainroom

**A darkroom that runs in your browser.**

Photos are decoded, processed and encoded on your own machine. There is no
upload endpoint in this codebase, no account, and no watermark at any export
size.

[Open the editor](https://grainroom.vercel.app/edit) ·
[Landing page](https://grainroom.vercel.app)

</div>

---

## What this is

A photo editor built from scratch on WebGL2. The tone and colour work happens
in shaders on the graphics card, at the image's native resolution, and the file
you save is the one the GPU computed rather than a scaled-up preview.

Alongside the editor there is a second idea, which is the part worth arguing
about: **a Look**. Every edit you make accumulates as a small recipe — slider
positions, curve control points, a few hundred bytes in total. That recipe is
deterministic, so it can be addressed by the hash of its own contents and handed
to someone else without moving the photograph anywhere.

## Why bother

Presets are a real economy. People spend weeks building a grade and sell it, and
within days the file is circulating in a shared folder. An authorised copy and a
lifted one are byte-identical, so there is nothing to appeal to. Photographers
also adapt each other's work constantly, which is healthy, but there is no record
of where a look came from once it has been renamed twice.

A Look carries its own lineage. When someone forks yours, their version records
yours as its parent, and that survives every subsequent hop.

## Running it

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. Requires a browser with WebGL2 — Chrome, Edge,
Firefox, and Safari 15 or later all qualify.

## How the pipeline is put together

Four passes per frame, in `src/lib/engine/`:

| Pass | File | Work |
|---|---|---|
| 1 | `FRAG_ADJUST` | Exposure in linear light, white balance, highlights and shadows, whites and blacks, contrast, fade, per-channel curves via a 256-step lookup, targeted HSL across eight hue bands, vibrance, ambiance, split toning, black and white channel mixer |
| 2–3 | `FRAG_BLUR` | Separable nine-tap gaussian, horizontal then vertical |
| 4 | `FRAG_COMPOSITE` | Structure and sharpening as unsharp masks against the blurred copy, dehaze, bloom, halation, lens blur, film grain, vignette |

Keeping one low-pass copy around from passes two and three is what lets
structure, sharpening, bloom and halation share a single blur rather than
computing four.

Render targets use `RGBA16F` where `EXT_color_buffer_float` is available, since
eight bits per channel bands visibly once you start pushing tone curves.

### The Look format

`src/lib/looks.ts`. Parameters are serialised with keys sorted and floats fixed
to six decimal places before hashing, so two people who arrive at the same
settings produce the same identifier regardless of the order they moved the
sliders in.

```ts
{
  format: "grainroom.look/v1",
  id: "<sha-256 of the canonical params>",
  name: "Safelight",
  author: "<optional signer>",
  parent: "<id of the Look this was forked from>",
  createdAt: 1754611200000,
  params: { /* ... */ }
}
```

Encoded base64url, a Look fits comfortably in a URL or a QR code.

## What runs today

Tune Image, White Balance, Details, Dehaze, Lens Blur, Tonality, Grain, Glow,
Split Tone, Colour HSL, Black & White, and the curve engine. Export to JPEG, PNG
or WebP at full resolution or a capped long edge.

## What does not yet

Crop and Rotate, Perspective, Expand, Selective control points, Brush, Healing,
Cut Out, Portrait, Double Exposure, Text, Frames, RAW Develop. These are listed
in the editor's tool panel rather than hidden, because a roadmap you cannot see
is a marketing document.

Cut Out will call the background removal service already running in
[Removix](https://github.com/bryankwandou/removix-ai).

## Interaction notes

The canvas responds to a two-axis drag: vertical movement steps through the
parameters of the active tool, horizontal movement changes the value. It is how
photographers already work one-handed on a phone, and it means the controls do
not have to cover the picture.

`\` held down shows the untouched original. `Ctrl+Z` and `Ctrl+Shift+Z` walk the
history stack.

## Stack

Next.js 16, React 19, TypeScript, Tailwind v4, and hand-written GLSL. No image
processing dependencies — the shaders are the product.

## Licence

MIT.

Grainroom is written from scratch. It is not affiliated with, derived from, or
endorsed by any other photo editing application, and it contains no code,
assets, or interface artwork from one.
