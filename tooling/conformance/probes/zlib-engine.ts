// The streaming half of `zlib`: a handle with a lifecycle, rather than one call.
//
// `zlib-oneshot.ts` proves the compressor produces node's bytes. This proves the
// *engine* around it: create, write incrementally, ask its status, reset it,
// change its parameters mid-stream, and close it. That is where a stateful
// binding goes wrong, and none of it was reachable before -- `zlib` does not
// compile, and the interpreted lane's stand-ins are node's own zlib.
//
// Every probe closes the handle it opened, including on the error paths, because
// a leaked engine is a real leak in a long-lived process and a probe that leaks
// is a probe that cannot be run twice.
//
// Modes and flushes are node's ABI: `DEFLATE` 1, `INFLATE` 2, `GZIP` 3,
// `Z_NO_FLUSH` 0, `Z_SYNC_FLUSH` 2, `Z_FINISH` 4.
declare function nts_zlib_create(
  mode: number,
  level: number,
  windowBits: number,
  memLevel: number,
  strategy: number,
  dictionary: Uint8Array,
  rejectGarbageAfterEnd: boolean,
): number;
declare function nts_zlib_write_sync(
  handle: number,
  flush: number,
  input: Uint8Array,
  maximumOutput: number,
): Uint8Array;
declare function nts_zlib_status(handle: number): number;
declare function nts_zlib_error_message(handle: number): string;
declare function nts_zlib_error_code(handle: number): string;
declare function nts_zlib_stream_ended(handle: number): boolean;
declare function nts_zlib_bytes_written(handle: number): number;
declare function nts_zlib_operation_pending(handle: number): boolean;
declare function nts_zlib_reset(handle: number): void;
declare function nts_zlib_params(handle: number, level: number, strategy: number): number;
declare function nts_zlib_close(handle: number): void;

const NO_DICTIONARY = new Uint8Array(0);
const MAXIMUM = 0xffff_ffff;

function toBytes(text: string): Uint8Array {
  const input = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index++) {
    input[index] = text.charCodeAt(index) & 0xff;
  }
  return input;
}

function joinBytes(bytes: Uint8Array): string {
  let out = "";
  for (let index = 0; index < bytes.length; index++) {
    out += `${bytes[index]},`;
  }
  return out;
}

function open(mode: number, level: number, windowBits: number): number {
  return nts_zlib_create(mode, level, windowBits, 8, 0, NO_DICTIONARY, false);
}

/** A handle is a positive number, and two opens do not collide. */
export function probeHandlesAreDistinct(): boolean {
  const first = open(1, 6, 15);
  const second = open(1, 6, 15);
  const distinct = first > 0 && second > 0 && first !== second;
  nts_zlib_close(first);
  nts_zlib_close(second);
  return distinct;
}

/** One `Z_FINISH` write through the engine, which must equal the one-shot. */
export function probeDeflateWhole(text: string, level: number): string {
  const handle = open(1, level, 15);
  if (handle < 0) return `create:${handle}`;
  const output = nts_zlib_write_sync(handle, 4, toBytes(text), MAXIMUM);
  const bytes = joinBytes(output);
  nts_zlib_close(handle);
  return bytes;
}

/**
 * Two writes with `Z_NO_FLUSH` then a `Z_FINISH`, concatenated. Streaming in
 * pieces must produce the same stream as compressing the whole at once, which is
 * the property a stateful compressor exists to have.
 */
export function probeDeflateInThree(a: string, b: string, c: string): string {
  const handle = open(1, 6, 15);
  if (handle < 0) return `create:${handle}`;
  let out = "";
  out += joinBytes(nts_zlib_write_sync(handle, 0, toBytes(a), MAXIMUM));
  out += joinBytes(nts_zlib_write_sync(handle, 0, toBytes(b), MAXIMUM));
  out += joinBytes(nts_zlib_write_sync(handle, 4, toBytes(c), MAXIMUM));
  nts_zlib_close(handle);
  return out;
}

/** `bytesWritten` counts input consumed, not output produced. */
export function probeBytesWritten(text: string): number {
  const handle = open(1, 6, 15);
  if (handle < 0) return -1;
  nts_zlib_write_sync(handle, 4, toBytes(text), MAXIMUM);
  const written = nts_zlib_bytes_written(handle);
  nts_zlib_close(handle);
  return written;
}

/** After a `Z_FINISH` on a deflater the stream has ended; before it, not. */
export function probeStreamEndedTransition(text: string): string {
  const handle = open(1, 6, 15);
  if (handle < 0) return `create:${handle}`;
  const before = nts_zlib_stream_ended(handle);
  nts_zlib_write_sync(handle, 4, toBytes(text), MAXIMUM);
  const after = nts_zlib_stream_ended(handle);
  nts_zlib_close(handle);
  return `${before}:${after}`;
}

/** A fresh engine is idle, clean and errorless. */
export function probeFreshEngineState(): string {
  const handle = open(1, 6, 15);
  if (handle < 0) return `create:${handle}`;
  const state = `${nts_zlib_status(handle)}:${nts_zlib_error_code(handle)}:` +
    `${nts_zlib_error_message(handle)}:${nts_zlib_operation_pending(handle)}:` +
    `${nts_zlib_bytes_written(handle)}`;
  nts_zlib_close(handle);
  return state;
}

/** Reset must return the engine to a state that compresses identically again. */
export function probeResetRestores(text: string): boolean {
  const handle = open(1, 6, 15);
  if (handle < 0) return false;
  const first = joinBytes(nts_zlib_write_sync(handle, 4, toBytes(text), MAXIMUM));
  nts_zlib_reset(handle);
  const second = joinBytes(nts_zlib_write_sync(handle, 4, toBytes(text), MAXIMUM));
  nts_zlib_close(handle);
  return first === second && first.length > 0;
}

/** `params` mid-stream, which zlib allows before any input is written. */
export function probeParamsAccepted(): number {
  const handle = open(1, 6, 15);
  if (handle < 0) return handle;
  const status = nts_zlib_params(handle, 1, 0);
  nts_zlib_close(handle);
  return status;
}

/** Inflating a stream the engine did not produce, to reach the error path. */
export function probeInflateGarbage(): string {
  const handle = open(2, 0, 15);
  if (handle < 0) return `create:${handle}`;
  const garbage = new Uint8Array(4);
  garbage[0] = 0xde;
  garbage[1] = 0xad;
  garbage[2] = 0xbe;
  garbage[3] = 0xef;
  nts_zlib_write_sync(handle, 4, garbage, MAXIMUM);
  const state = `${nts_zlib_status(handle)}:${nts_zlib_error_code(handle)}`;
  nts_zlib_close(handle);
  return state;
}

/** Closing twice must not crash, and a closed handle answers as absent. */
export function probeDoubleClose(): boolean {
  const handle = open(1, 6, 15);
  if (handle < 0) return false;
  nts_zlib_close(handle);
  nts_zlib_close(handle);
  return true;
}
