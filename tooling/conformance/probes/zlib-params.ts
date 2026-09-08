// The parameterized compressors: brotli and zstd, which take their settings as
// two parallel arrays rather than as fixed arguments.
//
// `zlib-oneshot.ts` and `zlib-engine.ts` cover the zlib family. This covers the
// other two families, which reach the same engine through
// `nts_zlib_create_params` and `nts_zlib_oneshot_params`. They are the last
// zlib bindings that had never run, and they matter because **node compares byte
// for byte here too**: `zlib.brotliCompressSync` and `zlib.zstdCompressSync` are
// deterministic for a given input and parameter set.
//
// Modes are node's ABI, from `zlib/src/constants.ts`: `BROTLI_DECODE` 8,
// `BROTLI_ENCODE` 9, `ZSTD_COMPRESS` 10, `ZSTD_DECOMPRESS` 11.
declare function nts_zlib_create_params(
  mode: number,
  keys: number[],
  values: number[],
  dictionary: Uint8Array,
  pledgedSourceSize: number,
  rejectGarbageAfterEnd: boolean,
): number;
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
declare function nts_zlib_last_error_message(): string;
declare function nts_zlib_last_status(): number;
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

/** A parameterized engine opens and closes, with no parameters set. */
export function probeCreateParams(mode: number): boolean {
  const keys: number[] = [];
  const values: number[] = [];
  const handle = nts_zlib_create_params(mode, keys, values, NO_DICTIONARY, -1, false);
  if (handle < 0) return false;
  nts_zlib_close(handle);
  return true;
}

/** And with a parameter actually set, which is the point of the form. */
export function probeCreateParamsWithSetting(mode: number, key: number, value: number): boolean {
  const keys: number[] = [key];
  const values: number[] = [value];
  const handle = nts_zlib_create_params(mode, keys, values, NO_DICTIONARY, -1, false);
  if (handle < 0) return false;
  nts_zlib_close(handle);
  return true;
}

export function probeOneshotParams(mode: number, text: string): string {
  const keys: number[] = [];
  const values: number[] = [];
  const output = nts_zlib_oneshot_params(
    mode, keys, values, NO_DICTIONARY, -1, 2, MAXIMUM, toBytes(text), false,
  );
  return joinBytes(output);
}

/** Compress then decompress through the same family, which must round-trip. */
export function probeParamsRoundTrip(encode: number, decode: number, text: string): string {
  const keys: number[] = [];
  const values: number[] = [];
  const compressed = nts_zlib_oneshot_params(
    encode, keys, values, NO_DICTIONARY, -1, 2, MAXIMUM, toBytes(text), false,
  );
  const back = nts_zlib_oneshot_params(
    decode, keys, values, NO_DICTIONARY, -1, 2, MAXIMUM, compressed, false,
  );
  let out = "";
  for (let index = 0; index < back.length; index++) {
    out += String.fromCharCode(back[index] ?? 0);
  }
  return out;
}

export function probeLastErrorMessageClean(): string {
  return nts_zlib_last_error_message();
}

export function probeLastStatusClean(): number {
  return nts_zlib_last_status();
}
