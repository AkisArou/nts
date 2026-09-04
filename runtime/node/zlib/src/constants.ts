// zlib's own constants, from `zlib.h`, `brotli/encode.h` and `zstd.h`.
//
// Hard-coded rather than read from a binding, which is the opposite of what
// `node:os` does for signals — and the difference is the point. A signal
// number is a property of the *operating system*: `SIGUSR1` is 10 on Linux and
// 30 on macOS, so reading it at build time is the only way to be right on the
// second platform. These are properties of a *file format* and its library's
// ABI. `Z_FINISH` is 4 in every zlib on every platform, because a compressed
// stream written on one machine has to be readable on another.

// Flush modes. The choice is a trade between compression and latency: a flush
// ends the current block, which lets the reader see everything so far and
// costs a few bytes of framing.
export const Z_NO_FLUSH = 0;
export const Z_PARTIAL_FLUSH = 1;
export const Z_SYNC_FLUSH = 2;
export const Z_FULL_FLUSH = 3;
export const Z_FINISH = 4;
export const Z_BLOCK = 5;
export const Z_TREES = 6;

// Return codes.
export const Z_OK = 0;
export const Z_STREAM_END = 1;
export const Z_NEED_DICT = 2;
export const Z_ERRNO = -1;
export const Z_STREAM_ERROR = -2;
export const Z_DATA_ERROR = -3;
export const Z_MEM_ERROR = -4;
export const Z_BUF_ERROR = -5;
export const Z_VERSION_ERROR = -6;

// Compression levels. `-1` asks the library for its own balance, which is 6.
export const Z_NO_COMPRESSION = 0;
export const Z_BEST_SPEED = 1;
export const Z_BEST_COMPRESSION = 9;
export const Z_DEFAULT_COMPRESSION = -1;

// Strategies. These are hints about the data, not modes: `Z_RLE` for data with
// long runs, `Z_FILTERED` for output of a filter, `Z_HUFFMAN_ONLY` to skip
// string matching entirely.
export const Z_FILTERED = 1;
export const Z_HUFFMAN_ONLY = 2;
export const Z_RLE = 3;
export const Z_FIXED = 4;
export const Z_DEFAULT_STRATEGY = 0;

export const Z_DEFAULT_WINDOWBITS = 15;
export const Z_MIN_WINDOWBITS = 8;
export const Z_MAX_WINDOWBITS = 15;
export const Z_MIN_CHUNK = 64;
export const Z_MAX_CHUNK = Infinity;
export const Z_DEFAULT_CHUNK = 16 * 1024;
export const Z_MIN_MEMLEVEL = 1;
export const Z_MAX_MEMLEVEL = 9;
export const Z_DEFAULT_MEMLEVEL = 8;
export const Z_MIN_LEVEL = -1;
export const Z_MAX_LEVEL = 9;
export const Z_DEFAULT_LEVEL = Z_DEFAULT_COMPRESSION;

// Which engine a handle drives. Node calls these the "mode" and they are the
// binding's own numbering rather than any library's.
export const DEFLATE = 1;
export const INFLATE = 2;
export const GZIP = 3;
export const GUNZIP = 4;
export const DEFLATERAW = 5;
export const INFLATERAW = 6;
export const UNZIP = 7;
export const BROTLI_DECODE = 8;
export const BROTLI_ENCODE = 9;
export const ZSTD_COMPRESS = 10;
export const ZSTD_DECOMPRESS = 11;

// Brotli. Its flush values are its own and do not match zlib's.
export const BROTLI_OPERATION_PROCESS = 0;
export const BROTLI_OPERATION_FLUSH = 1;
export const BROTLI_OPERATION_FINISH = 2;
export const BROTLI_OPERATION_EMIT_METADATA = 3;

export const BROTLI_PARAM_MODE = 0;
export const BROTLI_MODE_GENERIC = 0;
export const BROTLI_MODE_TEXT = 1;
export const BROTLI_MODE_FONT = 2;
export const BROTLI_DEFAULT_MODE = 0;

export const BROTLI_PARAM_QUALITY = 1;
export const BROTLI_MIN_QUALITY = 0;
export const BROTLI_MAX_QUALITY = 11;
export const BROTLI_DEFAULT_QUALITY = 11;

export const BROTLI_PARAM_LGWIN = 2;
export const BROTLI_MIN_WINDOW_BITS = 10;
export const BROTLI_MAX_WINDOW_BITS = 24;
export const BROTLI_LARGE_MAX_WINDOW_BITS = 30;
export const BROTLI_DEFAULT_WINDOW = 22;

export const BROTLI_PARAM_LGBLOCK = 3;
export const BROTLI_MIN_INPUT_BLOCK_BITS = 16;
export const BROTLI_MAX_INPUT_BLOCK_BITS = 24;

export const BROTLI_PARAM_DISABLE_LITERAL_CONTEXT_MODELING = 4;
export const BROTLI_PARAM_SIZE_HINT = 5;
export const BROTLI_PARAM_LARGE_WINDOW = 6;
export const BROTLI_PARAM_NPOSTFIX = 7;
export const BROTLI_PARAM_NDIRECT = 8;

export const BROTLI_DECODER_RESULT_ERROR = 0;
export const BROTLI_DECODER_RESULT_SUCCESS = 1;
export const BROTLI_DECODER_RESULT_NEEDS_MORE_INPUT = 2;
export const BROTLI_DECODER_RESULT_NEEDS_MORE_OUTPUT = 3;
export const BROTLI_DECODER_PARAM_DISABLE_RING_BUFFER_REALLOCATION = 0;
export const BROTLI_DECODER_PARAM_LARGE_WINDOW = 1;
export const BROTLI_DECODER_NO_ERROR = 0;
export const BROTLI_DECODER_SUCCESS = 1;
export const BROTLI_DECODER_NEEDS_MORE_INPUT = 2;
export const BROTLI_DECODER_NEEDS_MORE_OUTPUT = 3;

// Zstandard.
export const ZSTD_e_continue = 0;
export const ZSTD_e_flush = 1;
export const ZSTD_e_end = 2;
export const ZSTD_c_compressionLevel = 100;
export const ZSTD_c_checksumFlag = 201;
export const ZSTD_d_windowLogMax = 100;
export const ZSTD_CLEVEL_DEFAULT = 3;
export const ZSTD_MIN_CLEVEL = -99;
export const ZSTD_MAX_CLEVEL = 22;

/** The error names zlib reports, by code. */
export const codes: Record<string, string | number> = {
  Z_OK: "Z_OK",
  Z_STREAM_END: "Z_STREAM_END",
  Z_NEED_DICT: "Z_NEED_DICT",
  Z_ERRNO: "Z_ERRNO",
  Z_STREAM_ERROR: "Z_STREAM_ERROR",
  Z_DATA_ERROR: "Z_DATA_ERROR",
  Z_MEM_ERROR: "Z_MEM_ERROR",
  Z_BUF_ERROR: "Z_BUF_ERROR",
  Z_VERSION_ERROR: "Z_VERSION_ERROR",
};

// Node exposes the codes both ways round, so `codes[codes.Z_OK]` works.
for (const [name, value] of Object.entries({
  Z_OK, Z_STREAM_END, Z_NEED_DICT, Z_ERRNO, Z_STREAM_ERROR,
  Z_DATA_ERROR, Z_MEM_ERROR, Z_BUF_ERROR, Z_VERSION_ERROR,
})) {
  codes[name] = value;
  codes[String(value)] = name;
}
Object.freeze(codes);
