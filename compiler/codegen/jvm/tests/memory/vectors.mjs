// The oracle. Every line is `<label> <hex>` and the Java side must produce the
// same lines in the same order.
//
// Floats are printed as the *bit pattern of the resulting number*, not as text:
// a NaN read out of four bytes has a payload, `toString` says "NaN" for all of
// them, and the payload is exactly the part a hand-written accessor gets wrong.

const out = [];
const bitsBuf = new ArrayBuffer(8);
const bitsView = new DataView(bitsBuf);
function bits(x) {
  bitsView.setFloat64(0, x);
  return bitsView.getBigUint64(0).toString(16).padStart(16, "0");
}
function hex(bytes) {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

// A pattern with every awkward byte in it: zero, all ones, both sign bits, and
// the exponent field of a float32 NaN straddling a boundary.
const PATTERN = [
  0x00, 0xff, 0x80, 0x7f, 0x7f, 0xc0, 0x00, 0x01,
  0xff, 0xf0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x7f, 0xf0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01,
  0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef,
];

const source = new ArrayBuffer(PATTERN.length);
new Uint8Array(source).set(PATTERN);
const view = new DataView(source);

const READS = [
  ["i8", 1, (v, o) => v.getInt8(o)],
  ["u8", 1, (v, o) => v.getUint8(o)],
  ["i16", 2, (v, o, le) => v.getInt16(o, le)],
  ["u16", 2, (v, o, le) => v.getUint16(o, le)],
  ["i32", 4, (v, o, le) => v.getInt32(o, le)],
  ["u32", 4, (v, o, le) => v.getUint32(o, le)],
  ["f32", 4, (v, o, le) => v.getFloat32(o, le)],
  ["f64", 8, (v, o, le) => v.getFloat64(o, le)],
];

for (const [name, width, read] of READS) {
  for (let o = 0; o + width <= PATTERN.length; o++) {
    for (const le of [false, true]) {
      out.push(`get ${name} ${o} ${le ? "le" : "be"} ${bits(read(view, o, le))}`);
    }
  }
}

for (const name of ["bi64", "bu64"]) {
  for (let o = 0; o + 8 <= PATTERN.length; o++) {
    for (const le of [false, true]) {
      const got = name === "bi64" ? view.getBigInt64(o, le) : view.getBigUint64(o, le);
      out.push(`get ${name} ${o} ${le ? "le" : "be"} ${BigInt.asUintN(64, got).toString(16).padStart(16, "0")}`);
    }
  }
}

// Writes. Every hostile value into every offset, then the whole buffer, so a
// wrong byte anywhere shows even when the accessor's own read agrees.
const NUMBERS = [
  0, -0, 1, -1, 0.5, -0.5, 127, 128, 255, 256, 32767, 32768, 65535, 65536,
  2147483647, 2147483648, 4294967295, 4294967296, -2147483648, -2147483649,
  1e21, -1e21, 1 / 0, -1 / 0, NaN, 1.5e-45, 3.4028235e38, 5e-324, 1.7976931348623157e308,
];

const WRITES = [
  ["i8", 1, (v, o, x) => v.setInt8(o, x)],
  ["u8", 1, (v, o, x) => v.setUint8(o, x)],
  ["i16", 2, (v, o, x, le) => v.setInt16(o, x, le)],
  ["u16", 2, (v, o, x, le) => v.setUint16(o, x, le)],
  ["i32", 4, (v, o, x, le) => v.setInt32(o, x, le)],
  ["u32", 4, (v, o, x, le) => v.setUint32(o, x, le)],
  ["f32", 4, (v, o, x, le) => v.setFloat32(o, x, le)],
  ["f64", 8, (v, o, x, le) => v.setFloat64(o, x, le)],
];

for (const [name, width, write] of WRITES) {
  for (const x of NUMBERS) {
    for (const o of [0, 1, 3, 7]) {
      if (o + width > 16) continue;
      for (const le of [false, true]) {
        const scratch = new ArrayBuffer(16);
        new Uint8Array(scratch).fill(0xa5);
        write(new DataView(scratch), o, x, le);
        out.push(`set ${name} ${o} ${le ? "le" : "be"} ${bits(x)} ${hex(new Uint8Array(scratch))}`);
      }
    }
  }
}

const BIGS = [0n, 1n, -1n, 0x7fffffffffffffffn, -0x8000000000000000n, 0xdeadbeefcafebaben];
for (const name of ["bi64", "bu64"]) {
  for (const x of BIGS) {
    for (const o of [0, 1, 7]) {
      for (const le of [false, true]) {
        const scratch = new ArrayBuffer(16);
        new Uint8Array(scratch).fill(0xa5);
        const dv = new DataView(scratch);
        if (name === "bi64") dv.setBigInt64(o, BigInt.asIntN(64, x), le);
        else dv.setBigUint64(o, BigInt.asUintN(64, x), le);
        out.push(`set ${name} ${o} ${le ? "le" : "be"} ${BigInt.asUintN(64, x).toString(16).padStart(16, "0")} ${hex(new Uint8Array(scratch))}`);
      }
    }
  }
}

// Round trip. Read a float out of the hostile pattern and write it straight
// back, so the value passes through a JavaScript *number* on the way.
//
// This is the only vector that can tell `floatToRawIntBits` from
// `floatToIntBits`, and without it both were green: every NaN written directly
// is the canonical quiet one, so nothing had ever asked what happens to a
// payload. Whichever way node answers, the answer is a fact about the language
// and not a preference -- and if it canonicalises, the raw form is the bug.
for (const [name, width, read, write] of [
  ["f32", 4, (v, o, le) => v.getFloat32(o, le), (v, o, x, le) => v.setFloat32(o, x, le)],
  ["f64", 8, (v, o, le) => v.getFloat64(o, le), (v, o, x, le) => v.setFloat64(o, x, le)],
]) {
  for (let o = 0; o + width <= PATTERN.length; o++) {
    for (const le of [false, true]) {
      const scratch = new ArrayBuffer(16);
      new Uint8Array(scratch).fill(0xa5);
      write(new DataView(scratch), 0, read(view, o, le), le);
      out.push(`trip ${name} ${o} ${le ? "le" : "be"} ${hex(new Uint8Array(scratch))}`);
    }
  }
}

// The buffer itself: slice, resize, transfer, detach.
{
  const b = new ArrayBuffer(8);
  new Uint8Array(b).set([1, 2, 3, 4, 5, 6, 7, 8]);
  for (const [from, to] of [[0, 8], [2, 5], [-3, -1], [5, 2], [0, 100], [-100, 100], [3, 3]]) {
    out.push(`slice ${from} ${to} ${hex(new Uint8Array(b.slice(from, to)))}`);
  }
  out.push(`byteLength ${b.byteLength}`);
  out.push(`resizable ${b.resizable}`);
  out.push(`maxByteLength ${b.maxByteLength}`);
}
{
  const r = new ArrayBuffer(4, { maxByteLength: 12 });
  new Uint8Array(r).set([9, 8, 7, 6]);
  out.push(`grow-before ${r.byteLength} ${hex(new Uint8Array(r))}`);
  r.resize(8);
  out.push(`grow-after ${r.byteLength} ${hex(new Uint8Array(r))}`);
  r.resize(2);
  out.push(`shrink ${r.byteLength} ${hex(new Uint8Array(r))}`);
  r.resize(6);
  out.push(`regrow ${r.byteLength} ${hex(new Uint8Array(r))}`);
  out.push(`resizable ${r.resizable} ${r.maxByteLength}`);
}
{
  const t = new ArrayBuffer(4);
  new Uint8Array(t).set([1, 2, 3, 4]);
  const moved = t.transfer();
  out.push(`transfer ${t.detached} ${t.byteLength} ${moved.byteLength} ${hex(new Uint8Array(moved))}`);
  const grown = moved.transfer(6);
  out.push(`transfer-grow ${moved.detached} ${grown.byteLength} ${hex(new Uint8Array(grown))}`);
  const cut = grown.transfer(2);
  out.push(`transfer-shrink ${grown.detached} ${cut.byteLength} ${hex(new Uint8Array(cut))}`);
  const rr = new ArrayBuffer(4, { maxByteLength: 16 });
  const kept = rr.transfer();
  out.push(`transfer-keeps-resizable ${kept.resizable} ${kept.maxByteLength}`);
  const fixed = new ArrayBuffer(4, { maxByteLength: 16 }).transferToFixedLength();
  out.push(`transfer-to-fixed ${fixed.resizable} ${fixed.byteLength}`);
}

// What must fail. Node's error *text* is not comparable across engines, so
// only the fact is compared -- but the fact is the part that matters: an access
// that should throw and does not is a read past the end of the storage, which
// on the JVM is an exception escaping into a harness that reads it as a defect.
function attempt(label, body) {
  try { body(); out.push(`allows ${label}`); }
  catch (e) { out.push(`refuses ${label}`); }
}

{
  const b = new ArrayBuffer(8);
  const v = new DataView(b);
  attempt("read-past-end", () => v.getFloat64(1));
  attempt("read-at-end", () => v.getInt8(8));
  attempt("read-negative", () => v.getInt8(-1));
  attempt("read-fractional", () => v.getInt8(0.5));
  attempt("read-nan-offset", () => v.getInt8(NaN));
  attempt("read-huge-offset", () => v.getInt8(1e20));
  attempt("read-fractional-past-end", () => v.getFloat64(1.5));
  attempt("read-negative-fraction", () => v.getInt8(-0.5));
  attempt("read-infinite", () => v.getInt8(Infinity));
  attempt("read-2-53", () => v.getInt8(9007199254740991));
  attempt("read-2-53-plus", () => v.getInt8(9007199254740992));
  attempt("read-last", () => v.getInt8(7));
  attempt("read-last-f64", () => v.getFloat64(0));
  attempt("write-past-end", () => v.setInt32(6, 1));
  attempt("view-past-end", () => new DataView(b, 9));
  attempt("view-at-end", () => new DataView(b, 8));
  attempt("view-length-past-end", () => new DataView(b, 4, 8));
  attempt("view-negative-offset", () => new DataView(b, -1));
  attempt("view-fractional-offset", () => new DataView(b, 0.5));
  attempt("view-nan-offset", () => new DataView(b, NaN));
  attempt("view-fractional-length", () => new DataView(b, 0, 8.5));
}
{
  const b = new ArrayBuffer(8);
  const v = new DataView(b);
  b.transfer();
  attempt("read-detached", () => v.getInt8(0));
  attempt("write-detached", () => v.setInt8(0, 1));
  attempt("length-detached", () => v.byteLength);
  attempt("slice-detached", () => b.slice(0, 1));
  attempt("view-over-detached", () => new DataView(b));
}
{
  const fixed = new ArrayBuffer(8);
  attempt("resize-fixed", () => fixed.resize(4));
  const r = new ArrayBuffer(8, { maxByteLength: 16 });
  attempt("resize-in-range", () => r.resize(12));
  attempt("resize-past-max", () => r.resize(20));
  attempt("resize-negative", () => r.resize(-1));
  attempt("construct-past-max", () => new ArrayBuffer(20, { maxByteLength: 16 }));
  attempt("construct-fractional", () => new ArrayBuffer(4.5));
  attempt("construct-nan", () => new ArrayBuffer(NaN));
  attempt("construct-negative-fraction", () => new ArrayBuffer(-0.5));
  attempt("resize-fractional", () => r.resize(4.5));
  out.push(`resize-fractional-length ${r.byteLength}`);
}
{
  // A tracking view over a buffer that shrinks under it. The access was in
  // range when the view was made and is not now, which is the case a bounds
  // check against the construction-time length gets wrong.
  const r = new ArrayBuffer(16, { maxByteLength: 16 });
  const tracking = new DataView(r);
  attempt("shrink-before", () => tracking.getFloat64(8));
  r.resize(8);
  attempt("shrink-after", () => tracking.getFloat64(8));
  out.push(`shrink-length ${tracking.byteLength}`);
  r.resize(16);
  attempt("regrow-after", () => tracking.getFloat64(8));
}

process.stdout.write(out.join("\n") + "\n");
