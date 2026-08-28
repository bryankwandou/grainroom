# Grainroom — video

Three cuts of one argument, built with Remotion. This is its own npm project
inside the main repository, because it imports the editor's renderer directly
and there is no sense in it living somewhere that cannot see it.

| Composition | Format | Length | For |
|---|---|---|---|
| `Demo` | 1920×1080 | 70s | Hackathon submission, landing page |
| `Twitter` | 1920×1080 | 30s | Timeline, autoplayed muted |
| `Vertical` | 1080×1920 | 20s | Shorts, Reels, TikTok |

```bash
npm install
npm run frames        # shoot the stills with the editor's own renderer
npm run studio        # preview
npm run build:demo    # render the submission cut
```

`npm run frames` comes first and is not optional: the stills are not committed,
because they are derived data that the command reproduces exactly. The rendered
cuts in `out/` are committed, because they are what someone opening this
repository is looking for.

## Where the pictures come from

`npm run frames` bundles the editor's actual `GrainroomRenderer` and its demo
scene, runs them in headless Chrome, and captures one still per Look into
`public/frames`. Nothing in the video is a mockup, a screenshot of a mockup, or
a still of a slider that does not move.

That matters for this product specifically. The whole claim is that the editor
works offline on your own hardware and that the settlement happens on chain; a
video that illustrated either with motion graphics would be arguing against
itself. The before-and-after wipe in the first demo scene is two real renders of
the same scene, one untouched and one graded, produced by the same code the site
loads.

The capture window is sized per shot from `framedSize`, so a cropped frame is
delivered at its own shape rather than letterboxed inside the shape it was
cropped from.

The vertical cut gets its own portrait crop of the same photograph rather than
the landscape one scaled down. A phone holds a tall frame; a wide print inside
it leaves two thirds of the screen empty, and that reads as a video that was
made for something else and posted here anyway.

## The vocabulary

One entrance — rise and fade on a heavily damped spring — used for everything,
and one transition, a wipe with a thin safelight edge. A film that reaches for a
different technique every eight seconds reads as assembled rather than directed.

Type is Bodoni Moda for display, Archivo for body, JetBrains Mono for anything
with digits in it, matching the pitch deck and the site. Nothing on screen is
smaller than 26px, and no text block runs past eight words on a line.

## What the numbers are

Every figure shown is one a command reproduces:

- `0.200 / 0.010 / 0.190 SOL` — `node anchor/scripts/verify-devnet.js` in the
  main repository, against the live devnet program.
- `6 / 18 / 3` — settlement checks, pipeline assertions, and shader programs
  from that script, `npm run check:pipeline`, and `npm run check:shaders`.

If any of those change, the video is wrong and has to be recut. That is the
intended cost of putting real numbers on screen.
