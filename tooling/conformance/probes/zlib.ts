// The bindings in `zlib` that do not need a live stream handle.
//
// Most of `zlib`'s 20 bindings take a handle from `nts_zlib_create`, so probing
// them means standing up a compressor rather than calling a function -- a
// different and slower kind of probe. These are reachable directly, and `crc32`
// is one node exposes as a public API, so it is comparable rather than merely
// observable.
declare function nts_crc32(input: Uint8Array, initial: number): number;
declare function nts_zlib_vernum(): number;
declare function nts_zlib_last_status(): number;
declare function nts_zlib_last_error_code(): string;

// Built here rather than taken as a parameter: a `Uint8Array` parameter lowers
// but the Node-API wrapper declines to carry it -- see
// `blockers/arraybufferview-parameter`. So the probe takes the bytes as a string
// of code units below 256 and builds the array on this side of the boundary,
// which exercises the same binding.
export function probeCrc32(text: string, initial: number): number {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    bytes[i] = text.charCodeAt(i) & 0xff;
  }
  return nts_crc32(bytes, initial);
}

/**
 * **Not comparable to `zlib.constants.ZLIB_VERNUM`, and this is the example the
 * tool's caveat was written for.** An addon links the *system* zlib and node
 * bundles its own: 1.3.2 (`0x1320`) here against node's 1.3.2.1 (`0x1321`).
 * Comparing them reports a divergence that is a fact about the build rather than
 * a defect in anything.
 *
 * The honest check is against the system header, `/usr/include/zlib.h`, or
 * simply that it is a plausible version number. Kept in the probe because
 * "which zlib did this addon actually link" is worth being able to ask.
 */
export function probeVernum(): number {
  return nts_zlib_vernum();
}

export function probeLastStatus(): number {
  return nts_zlib_last_status();
}

export function probeLastErrorCode(): string {
  return nts_zlib_last_error_code();
}
