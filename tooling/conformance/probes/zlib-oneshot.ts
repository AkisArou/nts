// One-shot compression and decompression, compared byte for byte against node.
//
// This is the strongest comparison available in this tree. Every other probe
// asks whether a binding answers the same *number* node answers; this one asks
// whether it produces the same *bytes*, over a whole compressor. A deflate
// stream that differs by one byte from node's is a real defect and nothing else
// would catch it: `zlib`'s own tests round-trip through the same implementation,
// so a compressor that is self-consistently wrong passes them all.
//
// Modes and flush values are node's ABI, from `zlib/src/constants.ts`:
// `DEFLATE` 1, `INFLATE` 2, `GZIP` 3, `GUNZIP` 4, `Z_FINISH` 4,
// `Z_DEFAULT_COMPRESSION` -1.
declare function nts_zlib_oneshot(
  mode: number,
  level: number,
  windowBits: number,
  memLevel: number,
  strategy: number,
  dictionary: Uint8Array,
  finishFlush: number,
  maximumOutput: number,
  input: Uint8Array,
  rejectGarbageAfterEnd: boolean,
): Uint8Array;
declare function nts_zlib_last_status(): number;
declare function nts_zlib_last_error_code(): string;
declare function nts_zlib_vernum(): number;

/**
 * The bytes a one-shot produces, as a plain array so the boundary carries a
 * shape the wrapper can express.
 */
function run(
  mode: number,
  level: number,
  windowBits: number,
  input: Uint8Array,
): number[] {
  const output = nts_zlib_oneshot(
    mode,
    level,
    windowBits,
    8,
    0,
    new Uint8Array(0),
    4,
    0xffff_ffff,
    input,
    false,
  );
  const bytes: number[] = [];
  for (let index = 0; index < output.length; index++) {
    bytes.push(output[index] ?? 0);
  }
  return bytes;
}

function toBytes(text: string): Uint8Array {
  const input = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index++) {
    input[index] = text.charCodeAt(index) & 0xff;
  }
  return input;
}

export function probeDeflate(text: string, level: number): number[] {
  return run(1, level, 15, toBytes(text));
}

export function probeGzip(text: string, level: number): number[] {
  return run(3, level, 15, toBytes(text));
}

export function probeDeflateRaw(text: string, level: number): number[] {
  return run(1, level, -15, toBytes(text));
}

/** Round-trips through the other direction, so inflate is exercised too. */
export function probeInflateOfDeflate(text: string, level: number): number[] {
  const deflated = run(1, level, 15, toBytes(text));
  const asBytes = new Uint8Array(deflated.length);
  for (let index = 0; index < deflated.length; index++) {
    asBytes[index] = deflated[index] ?? 0;
  }
  return run(2, 0, 15, asBytes);
}

export function probeLastStatus(): number {
  return nts_zlib_last_status();
}

export function probeLastErrorCode(): string {
  return nts_zlib_last_error_code();
}

export function probeVernum(): number {
  return nts_zlib_vernum();
}
