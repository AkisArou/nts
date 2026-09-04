// The native half of `node:zlib`, for the node-side run only.
//
// The compression engine is a C library either way -- zlib, brotli, zstd. Here
// it is reached through node's own `zlib` streams, which are the same
// libraries with the same parameters, so a disagreement is about this module's
// assembly rather than about the compression.
//
// The seam is an *incremental* engine: create, feed with a flush mode, take
// what comes out, close. That is what `nts_zlib.h` offers and what the compiled
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
let lastInitializationError = null;

/** Resolve one bounded read without putting the host stream into flowing mode. */
function settleRead(engine) {
  const request = engine.request;
  if (request === null) return;

  if (engine.stream._readableState?.ended === true) {
    engine.ended = true;
    engine.operationDone = true;
  }

  if (engine.error) {
    engine.request = null;
    engine.active = false;
    engine.writing = false;
    engine.status = engine.error.errno ?? -3;
    request.resolve(Buffer.alloc(0));
    return;
  }

  const available = engine.stream.readableLength;
  if (available > 0) {
    const output = engine.stream.read(Math.min(available, request.limit));
    if (output !== null) {
      engine.request = null;
      engine.status = 0;
      if (engine.operationDone && engine.stream.readableLength === 0) {
        engine.active = false;
        engine.writing = false;
      }
      request.resolve(output);
      return;
    }
  }

  if (engine.operationDone || engine.ended) {
    // In paused/readable mode Node records the native end before it emits the
    // public `end` event. A zero-length read advances that state, and the
    // internal `ended` bit is the node-side stand-in for the C engine's direct
    // frame-complete result.
    engine.stream.read(0);
    if (engine.stream._readableState?.ended === true) engine.ended = true;
    engine.request = null;
    engine.active = false;
    engine.writing = false;
    engine.status = 0;
    request.resolve(Buffer.alloc(0));
  }
}

function operationCompleted(engine) {
  // A host write callback may run immediately before its error event. Give
  // that event one turn to set the status before reporting success.
  setImmediate(() => {
    engine.operationDone = true;
    settleRead(engine);
  });
}

function startOperation(engine, flush, input) {
  engine.active = true;
  engine.writing = true;
  engine.operationDone = false;
  engine.status = 0;

  if (engine.ended) {
    engine.operationDone = true;
    settleRead(engine);
    return;
  }

  const finishing = engine.family === "zlib" ? flush === 4 : flush === 2;
  if (finishing) {
    // Preserve explicit empty writes. Zstd uses even a zero-length write to
    // establish/check the pledged source size.
    // Completion comes from the readable side, not the writable end callback:
    // Node may call the latter just before the final output becomes readable.
    engine.stream.end(input);
  } else if (flush === 0) {
    engine.stream.write(input, () => operationCompleted(engine));
  } else {
    engine.stream.write(input);
    engine.stream.flush(flush, () => operationCompleted(engine));
  }
}

/** A paused host stream standing in for one incremental native engine. */
function makeEngine(stream, family, mode, options) {
  // `family` decides what "finish" means: 4 for zlib, 2 for brotli and zstd.
  // The numbers overlap -- 2 is `Z_SYNC_FLUSH` and also
  // `BROTLI_OPERATION_FINISH` -- so the flush value alone cannot say.
  const engine = {
    stream,
    family,
    mode,
    options,
    error: null,
    status: 0,
    ended: false,
    writing: false,
    active: false,
    operationDone: false,
    request: null,
  };
  stream.on("readable", () => settleRead(engine));
  stream.on("error", (error) => {
    engine.error = error;
    engine.operationDone = true;
    settleRead(engine);
  });
  stream.on("end", () => {
    engine.ended = true;
    engine.operationDone = true;
    settleRead(engine);
  });
  return engine;
}

globalThis.nts_zlib_create = (
  mode, level, windowBits, memLevel, strategy, dictionary,
  rejectGarbageAfterEnd = false,
) => {
  try {
    lastInitializationError = null;
    const options = {
      level, windowBits, memLevel, strategy, rejectGarbageAfterEnd,
    };
    if (dictionary.length > 0) options.dictionary = dictionary;
    const handle = nextHandle++;
    engines.set(handle, makeEngine(streamFactory[mode](options), "zlib", mode, options));
    return handle;
  } catch (error) {
    lastInitializationError = error;
    return -2; // Z_STREAM_ERROR
  }
};

globalThis.nts_zlib_create_params = (
  mode, keys, values, dictionary = [], pledgedSourceSize = -1,
  rejectGarbageAfterEnd = false,
) => {
  try {
    lastInitializationError = null;
    const params = {};
    for (let i = 0; i < keys.length; i++) params[keys[i]] = values[i];
    const options = { params, rejectGarbageAfterEnd };
    if (dictionary.length > 0) options.dictionary = dictionary;
    if (pledgedSourceSize >= 0) options.pledgedSrcSize = pledgedSourceSize;
    const handle = nextHandle++;
    engines.set(handle, makeEngine(
      streamFactory[mode](options),
      mode === BROTLI_ENCODE || mode === BROTLI_DECODE ? "brotli" : "zstd",
      mode,
      options,
    ));
    return handle;
  } catch (error) {
    lastInitializationError = error;
    return -2;
  }
};

globalThis.nts_zlib_write = (handle, flush, input, outputLimit) => new Promise((resolve) => {
  const engine = engines.get(handle);
  if (!engine) {
    resolve(Buffer.alloc(0));
    return;
  }
  engine.request = { resolve, limit: outputLimit };
  if (!engine.active) startOperation(engine, flush, input);
  settleRead(engine);
});

globalThis.nts_zlib_write_sync = (handle, flush, input, maximumOutput) => {
  const engine = engines.get(handle);
  if (!engine) return Buffer.alloc(0);
  const options = {
    ...engine.options,
    finishFlush: flush,
    maxOutputLength: maximumOutput,
  };
  try {
    const output = oneShotSync[engine.mode](input, options);
    engine.status = 0;
    return output;
  } catch (error) {
    engine.error = error;
    engine.status = error.errno ?? -3;
    throw error;
  }
};

globalThis.nts_zlib_status = (handle) => engines.get(handle)?.status ?? -2;

globalThis.nts_zlib_error_message = (handle) =>
  engines.get(handle)?.error?.message ?? lastInitializationError?.message ?? "";

globalThis.nts_zlib_error_code = (handle) =>
  engines.get(handle)?.error?.code ?? lastInitializationError?.code ?? "";

globalThis.nts_zlib_stream_ended = (handle) =>
  engines.get(handle)?.ended ?? false;

globalThis.nts_zlib_bytes_written = (handle) =>
  engines.get(handle)?.stream.bytesWritten ?? 0;

globalThis.nts_zlib_operation_pending = (handle) =>
  engines.get(handle)?.active ?? false;

globalThis.nts_zlib_reset = (handle) => {
  const engine = engines.get(handle);
  if (engine?.writing) {
    throw new Error("Cannot reset zlib stream while a write is in progress");
  }
  engine?.stream.reset?.();
};

globalThis.nts_zlib_params = (handle, level, strategy) => {
  const engine = engines.get(handle);
  // The TypeScript side has already flushed and serialized earlier writes.
  // Calling the public stream.params() here would enqueue a second flush and
  // report success before the parameters reached the native engine. This is
  // the node-side stand-in for the direct synchronous C `deflateParams` call.
  engine?.stream._handle?.params(level, strategy);
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
  mode, level, windowBits, memLevel, strategy, dictionary, finishFlush,
  maximumOutput, input,
  rejectGarbageAfterEnd = false,
) => {
  lastInitializationError = null;
  const options = {
    level, windowBits, memLevel, strategy, finishFlush, rejectGarbageAfterEnd,
    maxOutputLength: maximumOutput,
  };
  if (dictionary.length > 0) options.dictionary = dictionary;
  try {
    return oneShotSync[mode](input, options);
  } catch (error) {
    lastInitializationError = error;
    throw error;
  }
};

globalThis.nts_zlib_oneshot_params = (
  mode, keys, values, dictionary = [], pledgedSourceSize = -1, finishFlush,
  maximumOutput, input,
  rejectGarbageAfterEnd = false,
) => {
  lastInitializationError = null;
  const params = {};
  for (let i = 0; i < keys.length; i++) params[keys[i]] = values[i];
  const options = {
    params, finishFlush, rejectGarbageAfterEnd,
    maxOutputLength: maximumOutput,
  };
  if (dictionary.length > 0) options.dictionary = dictionary;
  if (pledgedSourceSize >= 0) options.pledgedSrcSize = pledgedSourceSize;
  try {
    return oneShotSync[mode](input, options);
  } catch (error) {
    lastInitializationError = error;
    throw error;
  }
};

// Host one-shot functions throw directly. Initialization failures are retained
// for the constructor's immediate status read; compiled C also uses this fixed
// slot because it cannot throw a TypeScript object itself.
globalThis.nts_zlib_last_status = () => lastInitializationError?.errno ?? 0;
globalThis.nts_zlib_last_error_message = () => lastInitializationError?.message ?? "";
globalThis.nts_zlib_last_error_code = () => lastInitializationError?.code ?? "";

globalThis.nts_crc32 = (input, initial) => zlib.crc32(Buffer.from(input), initial);
