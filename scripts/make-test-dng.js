/**
 * Writes a small, valid DNG for testing the RAW path.
 *
 * There is no RAW file in this repository and there should not be: camera
 * files are large and belong to whoever pressed the shutter. Building one
 * makes the test self-contained, and it makes it a real test rather than a
 * smoke check — the sensor data is a known pattern, so the developed result
 * can be checked against what was encoded rather than merely inspected for
 * not throwing.
 *
 * A DNG is a TIFF whose image data is the undebayered sensor mosaic, tagged
 * with the colour filter layout so a decoder knows which photosite saw which
 * colour. This writes the smallest set of tags LibRaw will accept.
 */
const fs = require("fs");

const W = 64;
const H = 48;

/* ---- the mosaic: red on the left, blue on the right, RGGB layout ---- */

const raw = Buffer.alloc(W * H * 2);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    // RGGB: even row even col = R, even row odd col = G,
    //       odd row even col = G, odd row odd col = B
    const isR = y % 2 === 0 && x % 2 === 0;
    const isB = y % 2 === 1 && x % 2 === 1;
    const left = x < W / 2;

    let v = 12000; // green everywhere, so the frame is exposed
    if (isR) v = left ? 60000 : 6000;
    if (isB) v = left ? 6000 : 60000;

    raw.writeUInt16LE(v, (y * W + x) * 2);
  }
}

/* ---- TIFF/DNG scaffolding ---- */

const SHORT = 3, LONG = 4, RATIONAL = 5, BYTE = 1, ASCII = 2, SRATIONAL = 10;

const entries = [];
const trailing = []; // values too big for the 4-byte inline slot
let trailingLen = 0;

function addTrailing(buf) {
  const at = buf;
  trailing.push(at);
  const offset = trailingLen;
  trailingLen += at.length + (at.length % 2); // keep everything word aligned
  return offset;
}

function entry(tag, type, count, valueBuf, inline) {
  entries.push({ tag, type, count, valueBuf, inline });
}

function ascii(tag, str) {
  const b = Buffer.from(str + "\0", "latin1");
  entry(tag, ASCII, b.length, b, b.length <= 4);
}

function shortVal(tag, ...vals) {
  const b = Buffer.alloc(vals.length * 2);
  vals.forEach((v, i) => b.writeUInt16LE(v, i * 2));
  entry(tag, SHORT, vals.length, b, b.length <= 4);
}

function longVal(tag, ...vals) {
  const b = Buffer.alloc(vals.length * 4);
  vals.forEach((v, i) => b.writeUInt32LE(v, i * 4));
  entry(tag, LONG, vals.length, b, b.length <= 4);
}

function byteVal(tag, ...vals) {
  const b = Buffer.from(vals);
  entry(tag, BYTE, vals.length, b, b.length <= 4);
}

function srational(tag, pairs) {
  const b = Buffer.alloc(pairs.length * 8);
  pairs.forEach(([n, d], i) => {
    b.writeInt32LE(n, i * 8);
    b.writeInt32LE(d, i * 8 + 4);
  });
  entry(tag, SRATIONAL, pairs.length, b, false);
}

// The raw strip goes after the IFD; its offset is patched in once the IFD
// size is known, which is why StripOffsets is written last.
longVal(254, 0);                    // NewSubfileType: the main image
longVal(256, W);                    // ImageWidth
longVal(257, H);                    // ImageLength
shortVal(258, 16);                  // BitsPerSample
shortVal(259, 1);                   // Compression: none
shortVal(262, 32803);               // PhotometricInterpretation: CFA
ascii(271, "Grainroom");            // Make
ascii(272, "Synthetic Sensor");     // Model
longVal(273, 0);                    // StripOffsets — patched below
shortVal(277, 1);                   // SamplesPerPixel
longVal(278, H);                    // RowsPerStrip
longVal(279, raw.length);           // StripByteCounts
shortVal(33421, 2, 2);              // CFARepeatPatternDim
byteVal(33422, 0, 1, 1, 2);         // CFAPattern: R G / G B
byteVal(50706, 1, 4, 0, 0);         // DNGVersion
byteVal(50707, 1, 1, 0, 0);         // DNGBackwardVersion
ascii(50708, "Grainroom Synthetic");// UniqueCameraModel
shortVal(50714, 0);                 // BlackLevel
longVal(50717, 65535);              // WhiteLevel
// A plain identity-ish matrix: this is a synthetic sensor, so there is no
// real characterisation to describe.
srational(50721, [
  [10000, 10000], [0, 10000], [0, 10000],
  [0, 10000], [10000, 10000], [0, 10000],
  [0, 10000], [0, 10000], [10000, 10000],
]);
shortVal(50778, 21);                // CalibrationIlluminant1: D65

entries.sort((a, b) => a.tag - b.tag);

const HEADER = 8;
const ifdSize = 2 + entries.length * 12 + 4;
const trailingStart = HEADER + ifdSize;

// Lay out the values that did not fit inline.
for (const e of entries) {
  if (!e.inline) e.offset = trailingStart + addTrailing(e.valueBuf);
}
const rawOffset = trailingStart + trailingLen;

const head = Buffer.alloc(HEADER);
head.write("II", 0, "latin1");
head.writeUInt16LE(42, 2);
head.writeUInt32LE(HEADER, 4);

const ifd = Buffer.alloc(ifdSize);
ifd.writeUInt16LE(entries.length, 0);
entries.forEach((e, i) => {
  const at = 2 + i * 12;
  ifd.writeUInt16LE(e.tag, at);
  ifd.writeUInt16LE(e.type, at + 2);
  ifd.writeUInt32LE(e.count, at + 4);
  if (e.tag === 273) {
    ifd.writeUInt32LE(rawOffset, at + 8);
  } else if (e.inline) {
    e.valueBuf.copy(ifd, at + 8);
  } else {
    ifd.writeUInt32LE(e.offset, at + 8);
  }
});
ifd.writeUInt32LE(0, ifdSize - 4); // no next IFD

const pad = [];
for (const b of trailing) {
  pad.push(b);
  if (b.length % 2) pad.push(Buffer.alloc(1));
}

const out = Buffer.concat([head, ifd, ...pad, raw]);
const target = process.argv[2] || ".e2e/test.dng";
fs.mkdirSync(require("path").dirname(target), { recursive: true });
fs.writeFileSync(target, out);
console.log(
  `wrote ${target} — ${W}x${H} RGGB, ${out.length} bytes ` +
    `(red left, blue right)`
);
