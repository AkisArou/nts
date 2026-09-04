// The native half of `node:zlib`, for the node-side run only.
//
// The compression engine is a C library either way -- zlib, brotli, zstd. Here
// it is reached through node's own `zlib` streams, which are the same
// libraries with the same parameters, so a disagreement is about this module's
// assembly rather than about the compression.
//
// The seam is an *incremental* engine: create, feed with a flush mode, take
// what comes out, close. That is what `zlib.h` offers and what the compiled
// runtime will call directly. Node does not expose an incremental engine
// synchronously, so each handle here is one of node's streams with its output
// collected -- which is asynchronous, and fits because `Transform._transform`
// takes a callback anyway.
import "../internal/bindings.node.mjs";
import "../stream/bindings.node.mjs";
import zlib from "node:zlib";
import { Buffer } from "node:buffer";

const {
  DEFLATE, INFLATE, GZIP, GUNZIP, DEFLATERAW, INFLATERAW, UNZIP,
  BROTLI_DECODE, BROTLI_ENCODE, ZSTD_COMPRESS, ZSTD_DECOMPRESS,
} = { DEFLATE: 1, INFLATE: 2, GZIP: 3, GUNZIP: 4, DEFLATERAW: 5, INFLATERAW: 6, UNZIP: 7,
      BROTLI_DECODE: 8, BROTLI_ENCODE: 9, ZSTD_COMPRESS: 10, ZSTD_DECOMPRESS: 11 };

const streamFactory = {
  [DEFLATE]: zlib.createDeflate,
  [INFLATE]: zlib.createInflate,
  [GZIP]: zlib.createGzip,
  [GUNZIP]: zlib.createGunzip,
  [DEFLATERAW]: zlib.createDeflateRaw,
  [INFLATERAW]: zlib.createInflateRaw,
  [UNZIP]: zlib.createUnzip,
  [BROTLI_ENCODE]: zlib.createBrotliCompress,
  [BROTLI_DECODE]: zlib.createBrotliDecompress,
  [ZSTD_COMPRESS]: zlib.createZstdCompress,
  [ZSTD_DECOMPRESS]: zlib.createZstdDecompress,
};

const oneShotSync = {
  [DEFLATE]: zlib.deflateSync,
  [INFLATE]: zlib.inflateSync,
  [GZIP]: zlib.gzipSync,
  [GUNZIP]: zlib.gunzipSync,
  [DEFLATERAW]: zlib.deflateRawSync,
  [INFLATERAW]: zlib.inflateRawSync,
  [UNZIP]: zlib.unzipSync,
  [BROTLI_ENCODE]: zlib.brotliCompressSync,
  [BROTLI_DECODE]: zlib.brotliDecompressSync,
  [ZSTD_COMPRESS]: zlib.zstdCompressSync,
  [ZSTD_DECOMPRESS]: zlib.zstdDecompressSync,
};

let nextHandle = 1;
const engines = new Map();

/** Collect a stream's output so a write can hand back what it produced. */
function makeEngine(stream, family) {
  // `family` decides what "finish" means: 4 for zlib, 2 for brotli and zstd.
  // The numbers overlap -- 2 is `Z_SYNC_FLUSH` and also
  // `BROTLI_OPERATION_FINISH` -- so the flush value alone cannot say.
  const engine = { stream, family, pending: [], error: null, ended: false };
  stream.on("data", (chunk) => engine.pending.push(chunk));
  stream.on("error", (e) => { engine.error = e; });
  stream.on("end", () => { engine.ended = true; });
  return engine;
}

globalThis.nts_zlib_create = (mode, level, windowBits, memLevel, strategy, dictionary) => {
  try {
    const options = { level, windowBits, memLevel, strategy };
    if (dictionary.length > 0) options.dictionary = Buffer.from(dictionary);
    const handle = nextHandle++;
    engines.set(handle, makeEngine(streamFactory[mode](options), "zlib"));
    return handle;
  } catch {
    return -2; // Z_STREAM_ERROR
  }
};

globalThis.nts_zlib_create_params = (mode, keys, values) => {
  try {
    const params = {};
    for (let i = 0; i < keys.length; i++) params[keys[i]] = values[i];
    const handle = nextHandle++;
    engines.set(handle, makeEngine(streamFactory[mode]({ params }),
      mode === BROTLI_ENCODE || mode === BROTLI_DECODE ? "brotli" : "zstd"));
    return handle;
  } catch {
    return -2;
  }
};

globalThis.nts_zlib_write = (handle, flush, input, cb) => {
  const engine = engines.get(handle);
  if (!engine) {
    cb(-2, []);
    return;
  }

  // Once. `end` and `error` are both registered below and either may arrive;
  // calling back twice makes one write look like two to everything above.
  let settled = false;
  const take = () => {
    if (settled) return;
    settled = true;
    if (engine.error) {
      cb(engine.error.errno ?? -3, []);
      return;
    }
    const out = Buffer.concat(engine.pending);
    engine.pending.length = 0;
    cb(0, Array.from(out));
  };

  if (input.length > 0) engine.stream.write(Buffer.from(input));

  // The finishing flush ends the stream; anything else asks the engine to
  // emit what it has without ending. `Z_NO_FLUSH` asks for nothing at all, so
  // there is only whatever the engine chose to produce on its own.
  const finishing = engine.family === "zlib" ? flush === 4 : flush === 2;

  if (finishing) {
    if (engine.ended) {
      take();
    } else {
      engine.stream.end();
      engine.stream.once("end", take);
      engine.stream.once("error", take);
    }
  } else if (flush === 0) {
    setImmediate(take);
  } else {
    engine.stream.flush(flush, take);
  }
};

globalThis.nts_zlib_error_message = (handle) =>
  engines.get(handle)?.error?.message ?? "";

globalThis.nts_zlib_reset = (handle) => {
  const engine = engines.get(handle);
  engine?.stream.reset?.();
};

globalThis.nts_zlib_params = (handle, level, strategy) => {
  const engine = engines.get(handle);
  if (engine?.stream.params) engine.stream.params(level, strategy, () => {});
  return 0;
};

globalThis.nts_zlib_close = (handle) => {
  const engine = engines.get(handle);
  if (engine) {
    engine.stream.destroy();
    engines.delete(handle);
  }
};

globalThis.nts_zlib_oneshot = (
  mode, level, windowBits, memLevel, strategy, dictionary, finishFlush, input,
) => {
  const options = { level, windowBits, memLevel, strategy, finishFlush };
  if (dictionary.length > 0) options.dictionary = Buffer.from(dictionary);
  return Array.from(oneShotSync[mode](Buffer.from(input), options));
};

globalThis.nts_zlib_oneshot_params = (mode, keys, values, input) => {
  const params = {};
  for (let i = 0; i < keys.length; i++) params[keys[i]] = values[i];
  return Array.from(oneShotSync[mode](Buffer.from(input), { params }));
};

globalThis.nts_crc32 = (input, initial) => zlib.crc32(Buffer.from(input), initial);
