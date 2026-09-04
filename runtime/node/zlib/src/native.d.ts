/**
 * Native compression ABI shared by `node:zlib` and `node:zlib/iter`.
 *
 * These declarations emit no wrappers. Each name is supplied by
 * `bindings.node.mjs` during the TypeScript oracle run and by `zlib.c` in a
 * compiled profile.
 */
declare function nts_zlib_create(
  mode: number,
  level: number,
  windowBits: number,
  memLevel: number,
  strategy: number,
  dictionary: Uint8Array,
  rejectGarbageAfterEnd: boolean,
): number;

declare function nts_zlib_create_params(
  mode: number,
  keys: number[],
  values: number[],
  dictionary: Uint8Array,
  pledgedSourceSize: number,
  rejectGarbageAfterEnd: boolean,
): number;

declare function nts_zlib_write(
  handle: number,
  flush: number,
  input: Uint8Array,
  outputLimit: number,
): Promise<Uint8Array>;

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

declare function nts_zlib_oneshot_params(
  mode: number,
  keys: number[],
  values: number[],
  dictionary: Uint8Array,
  pledgedSourceSize: number,
  finishFlush: number,
  maximumOutput: number,
  input: Uint8Array,
  rejectGarbageAfterEnd: boolean,
): Uint8Array;

declare function nts_zlib_last_status(): number;
declare function nts_zlib_last_error_message(): string;
declare function nts_zlib_last_error_code(): string;

declare function nts_crc32(input: Uint8Array, initial: number): number;
