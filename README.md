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

GLSL compiles at runtime, so a typo in a shader survives both `tsc` and
`next build` and then breaks the editor for everyone at once. `npm run
check:shaders` drives a real WebGL2 context in headless Chrome, compiles and
links all three programs against the same sources the app imports, and lists
the uniforms that survived linking — a uniform the renderer sets but the
linker dropped looks exactly like a tool that quietly does nothing.

`npm run check:pipeline` goes further and asserts behaviour. It bundles the
renderer from source, paints a synthetic photograph — two colours and one
blemish — and reads the rendered pixels back the same way `toBlob()` does on
export: a crop has to halve the output, a quarter turn has to bring the left
half to the top, a dodging brush has to lighten what it covers, healing has to
fill the blemish with the colour around it, and a caption has to appear where
it was placed. Compiling was never the hard part to get right.

`npm run check:app` goes further still and opens the application. With the dev
server running, it drives a real browser: loads a photograph through the file
input, drags Exposure and checks the canvas actually changed, undoes it and
checks the pixels came back, crops to a square and measures the frame, taps a
selective point, paints a stroke, lays a second photograph over the first,
clicks Save to device and confirms a real JPEG landed on disk. It also records
every network request the page makes, with the size of whatever it carried, and
fails if any of them looks like a photograph — so "your picture is not
uploaded" is a condition the suite enforces rather than a sentence in this file.

Two hosts are contacted and both are named in that check rather than waved
through. Devnet is asked whether a Look has been claimed, which is a lookup of
a hash. And the first time Cut Out is used, the subject model's weights are
fetched from the vendor's CDN, because they are 221 MB and serving that from
this origin is not sensible. Both are downloads. The photograph is what may not
move, and it does not: the largest thing this project has ever sent off-origin
is a 192-byte hash.

That one found "Back to the full frame" resetting crop and rotation but not
expand or perspective, which left the button lit and the frame still altered.
A broken file input, a panel that never mounts, or an export button wired to
nothing would pass every other check here and still leave nobody able to edit a
photograph.

The first thing it caught was that every photograph had been rendering upside
down. Clip space counts upward and every image the pipeline touches counts
downward — the first row of a texture, the first row of the canvas a caption is
drawn on, the `y` of a pointer event — and the mismatch cancelled itself across
the four passes, so nothing that only compiles the code could see it.

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

Tune Image, White Balance, Selective, Brush, Healing, Details, Dehaze, Lens
Blur, Tonality, Grain, Glow, Split Tone, Cut Out, Double Exposure, Text, Colour
HSL, Black & White, Crop & Rotate, Expand, Perspective, Portrait, Frames, and
the curve engine — twenty-three of them. RAW files are developed on open.
Export to JPEG, PNG or WebP at full resolution or a capped long edge.

Geometry — crop, quarter turns, straighten, keystone, expand — is folded into
the first pass rather than run as a stage of its own, so the blur, grain and
vignette further down the chain all land relative to the frame the viewer
actually gets. Expand fills what it opens up by reflecting the border back in.

Selective points are stored in source coordinates, not frame coordinates, so
cropping or turning the photo afterwards leaves each point on the feature it
was placed on. Each one holds to tones like the one underneath it, which is
what stops brightening a face from dragging the wall behind it along too.

Brush, Healing and Text ship as marks rather than as bitmaps: brush dabs and
healing patches are stored as coordinates in the source image, and the caption
is drawn into a texture at output resolution. A fully worked Look still fits
in a link, and the preview and the export are the same pixels rather than two
renderers that agree most of the time.

## What does not yet

Nothing. Both of the last two turned out to rest on a false premise.

Cut Out was refused because it seemed to need a background removal service, and
a network call would break the promise that the editor works with nothing
connected. It does not need one: the segmentation model runs here, in the
browser, downloaded once and cached. The photograph is still never sent
anywhere for a server to look at, which is the part that actually matters.

RAW Develop was refused because a demosaic has to happen before the pipeline
can touch anything. That is true, and it is now done by LibRaw compiled to
WebAssembly, in a worker, on the same machine. Drop a .cr3 or a .nef and it is
developed with the camera's own white balance and colour matrix, highlights
clipped rather than invented, and automatic brightness off — exposure is a
decision for the Tune Image slider, not one the decoder should make quietly
first.

The roadmap section stays in the interface even though it is empty. The next
thing that cannot be built yet belongs there, in public, with the reason.

Double Exposure was on that list too, until it was reconsidered. The objection had
been that a Look cannot carry a second photograph — but a Look never carried the
first one either. It describes what to do with pixels it is handed, and the
second frame is chosen when the Look is applied, exactly as the first one is.
What travels is the blend mode, strength, scale and position; the recipe still
fits in a link.

## The video

`video/` is a Remotion project that imports this renderer directly. `npm run
frames` inside it drives the real pipeline in headless Chrome and captures one
still per Look, so the before-and-after in the film is two genuine renders of
the same photograph rather than a mockup. For a product whose claim is that it
works on your own machine, illustrating that with motion graphics would have
been arguing against itself.

## Interaction notes

The canvas responds to a two-axis drag: vertical movement steps through the
parameters of the active tool, horizontal movement changes the value. It is how
photographers already work one-handed on a phone, and it means the controls do
not have to cover the picture.

Under Selective the same drag is aimed at a point instead: tap the photo to
leave one or pick one up, drag sideways to move its value, up and down to swap
between brightness, contrast, saturation and reach.

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
