/**
 * Opening a photograph the browser cannot decode on its own.
 *
 * A RAW file is not an image yet. It is one brightness per photosite behind a
 * colour filter array, and turning that into pixels means demosaicing it —
 * work that has to happen before anything in this editor can touch it. The
 * browser will not do it, so LibRaw does, compiled to WebAssembly and run
 * here rather than on a server. Nothing about the file leaves the machine.
 */

/**
 * Extensions worth trying LibRaw on.
 *
 * Deliberately a list rather than "anything the browser refused": a corrupt
 * JPEG should report itself as a corrupt JPEG, not spend twenty seconds in a
 * RAW decoder before failing for a second, more confusing reason.
 */
const RAW_EXTENSIONS = [
  "arw", "srf", "sr2",           // Sony
  "cr2", "cr3", "crw",           // Canon
  "nef", "nrw",                  // Nikon
  "raf",                         // Fujifilm
  "orf",                         // Olympus
  "rw2",                         // Panasonic
  "pef", "ptx",                  // Pentax
  "srw",                         // Samsung
  "dng",                         // Adobe and phones
  "raw", "rwl", "iiq", "3fr", "erf", "mef", "mos", "x3f",
];

export function looksLikeRaw(file: File): boolean {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return RAW_EXTENSIONS.includes(ext);
}

export interface DevelopedRaw {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  camera: string | null;
}

/**
 * Develops a RAW file into pixels this editor can work on.
 *
 * The settings are the ones a photographer would expect a sensible default
 * develop to use: the camera's own white balance, its colour matrix, the
 * highest quality interpolation, and no automatic brightness — because
 * exposure is a decision the person makes with the Tune Image slider, not one
 * the decoder should quietly make first.
 */
export async function developRaw(file: File): Promise<DevelopedRaw> {
  const { default: LibRaw } = await import("libraw-wasm");
  const decoder = new LibRaw();
  const bytes = new Uint8Array(await file.arrayBuffer());

  await decoder.open(bytes, {
    useCameraWb: true,
    useCameraMatrix: 3,
    userQual: 3,        // AHD: slower than bilinear, far better on detail
    outputColor: 1,     // sRGB, which is what the rest of the pipeline expects
    outputBps: 8,
    noAutoBright: true,
    highlight: 0,       // clip rather than invent colour in blown highlights
  });

  const image = await decoder.imageData();
  if (!image || !image.width || !image.height) {
    throw new Error("This RAW file could not be developed.");
  }

  // LibRaw hands back tightly packed RGB; a canvas wants RGBA.
  const { width, height, colors, data } = image;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, p = 0; i < width * height; i++) {
    const s = i * colors;
    rgba[p++] = data[s];
    rgba[p++] = colors > 1 ? data[s + 1] : data[s];
    rgba[p++] = colors > 2 ? data[s + 2] : data[s];
    rgba[p++] = 255;
  }

  let camera: string | null = null;
  try {
    const meta = await decoder.metadata(true);
    const make = (meta?.make ?? "").toString().trim();
    const model = (meta?.model ?? "").toString().trim();
    camera = [make, model].filter(Boolean).join(" ") || null;
  } catch {
    // Metadata is a nicety. A file that develops but will not describe itself
    // is still a photograph.
  }

  const bitmap = await createImageBitmap(new ImageData(rgba, width, height));
  return { bitmap, width, height, camera };
}
