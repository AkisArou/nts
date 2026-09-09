// The object node's tests see as `require('zlib')`.

// These nine constructors predate classes and remain callable without `new`.
// Keep that legacy function-object shape out of the typed implementation: the
// compression classes themselves are ordinary static classes, and this Node
// facade is the only place that needs prototypes, function metadata, and
// `new.target`.
const legacyConstructorNames = [
  "Deflate",
  "Inflate",
  "Gzip",
  "Gunzip",
  "DeflateRaw",
  "InflateRaw",
  "Unzip",
  "BrotliCompress",
  "BrotliDecompress",
];

const implementationExportNames = ["Brotli", "Zlib", "ZlibBase", "ZlibError", "Zstd"];

const factoryNames = [
  "createBrotliCompress",
  "createBrotliDecompress",
  "createDeflate",
  "createDeflateRaw",
  "createGunzip",
  "createGzip",
  "createInflate",
  "createInflateRaw",
  "createUnzip",
  "createZstdCompress",
  "createZstdDecompress",
];

// `lib/zlib.js` and its native constants binding populate ordinary CommonJS
// objects in these orders. ESM namespace enumeration is sorted, which is why
// copying `exports` or `exports.constants` directly loses this part of Node's
// public shape.
const publicExportNames = [
  "crc32",
  "Deflate",
  "Inflate",
  "Gzip",
  "Gunzip",
  "DeflateRaw",
  "InflateRaw",
  "Unzip",
  "BrotliCompress",
  "BrotliDecompress",
  "ZstdCompress",
  "ZstdDecompress",
  "deflate",
  "deflateSync",
  "gzip",
  "gzipSync",
  "deflateRaw",
  "deflateRawSync",
  "unzip",
  "unzipSync",
  "inflate",
  "inflateSync",
  "gunzip",
  "gunzipSync",
  "inflateRaw",
  "inflateRawSync",
  "brotliCompress",
  "brotliCompressSync",
  "brotliDecompress",
  "brotliDecompressSync",
  "zstdCompress",
  "zstdCompressSync",
  "zstdDecompress",
  "zstdDecompressSync",
  "createDeflate",
  "createInflate",
  "createDeflateRaw",
  "createInflateRaw",
  "createGzip",
  "createGunzip",
  "createUnzip",
  "createBrotliCompress",
  "createBrotliDecompress",
  "createZstdCompress",
  "createZstdDecompress",
];

const constantNames = [
  "Z_NO_FLUSH",
  "Z_PARTIAL_FLUSH",
  "Z_SYNC_FLUSH",
  "Z_FULL_FLUSH",
  "Z_FINISH",
  "Z_BLOCK",
  "Z_OK",
  "Z_STREAM_END",
  "Z_NEED_DICT",
  "Z_ERRNO",
  "Z_STREAM_ERROR",
  "Z_DATA_ERROR",
  "Z_MEM_ERROR",
  "Z_BUF_ERROR",
  "Z_VERSION_ERROR",
  "Z_NO_COMPRESSION",
  "Z_BEST_SPEED",
  "Z_BEST_COMPRESSION",
  "Z_DEFAULT_COMPRESSION",
  "Z_FILTERED",
  "Z_HUFFMAN_ONLY",
  "Z_RLE",
  "Z_FIXED",
  "Z_DEFAULT_STRATEGY",
  "ZLIB_VERNUM",
  "DEFLATE",
  "INFLATE",
  "GZIP",
  "GUNZIP",
  "DEFLATERAW",
  "INFLATERAW",
  "UNZIP",
  "BROTLI_DECODE",
  "BROTLI_ENCODE",
  "ZSTD_DECOMPRESS",
  "ZSTD_COMPRESS",
  "Z_MIN_WINDOWBITS",
  "Z_MAX_WINDOWBITS",
  "Z_DEFAULT_WINDOWBITS",
  "Z_MIN_CHUNK",
  "Z_MAX_CHUNK",
  "Z_DEFAULT_CHUNK",
  "Z_MIN_MEMLEVEL",
  "Z_MAX_MEMLEVEL",
  "Z_DEFAULT_MEMLEVEL",
  "Z_MIN_LEVEL",
  "Z_MAX_LEVEL",
  "Z_DEFAULT_LEVEL",
  "BROTLI_OPERATION_PROCESS",
  "BROTLI_OPERATION_FLUSH",
  "BROTLI_OPERATION_FINISH",
  "BROTLI_OPERATION_EMIT_METADATA",
  "BROTLI_PARAM_MODE",
  "BROTLI_MODE_GENERIC",
  "BROTLI_MODE_TEXT",
  "BROTLI_MODE_FONT",
  "BROTLI_DEFAULT_MODE",
  "BROTLI_PARAM_QUALITY",
  "BROTLI_MIN_QUALITY",
  "BROTLI_MAX_QUALITY",
  "BROTLI_DEFAULT_QUALITY",
  "BROTLI_PARAM_LGWIN",
  "BROTLI_MIN_WINDOW_BITS",
  "BROTLI_MAX_WINDOW_BITS",
  "BROTLI_LARGE_MAX_WINDOW_BITS",
  "BROTLI_DEFAULT_WINDOW",
  "BROTLI_PARAM_LGBLOCK",
  "BROTLI_MIN_INPUT_BLOCK_BITS",
  "BROTLI_MAX_INPUT_BLOCK_BITS",
  "BROTLI_PARAM_DISABLE_LITERAL_CONTEXT_MODELING",
  "BROTLI_PARAM_SIZE_HINT",
  "BROTLI_PARAM_LARGE_WINDOW",
  "BROTLI_PARAM_NPOSTFIX",
  "BROTLI_PARAM_NDIRECT",
  "BROTLI_DECODER_RESULT_ERROR",
  "BROTLI_DECODER_RESULT_SUCCESS",
  "BROTLI_DECODER_RESULT_NEEDS_MORE_INPUT",
  "BROTLI_DECODER_RESULT_NEEDS_MORE_OUTPUT",
  "BROTLI_DECODER_PARAM_DISABLE_RING_BUFFER_REALLOCATION",
  "BROTLI_DECODER_PARAM_LARGE_WINDOW",
  "BROTLI_DECODER_NO_ERROR",
  "BROTLI_DECODER_SUCCESS",
  "BROTLI_DECODER_NEEDS_MORE_INPUT",
  "BROTLI_DECODER_NEEDS_MORE_OUTPUT",
  "BROTLI_DECODER_ERROR_FORMAT_EXUBERANT_NIBBLE",
  "BROTLI_DECODER_ERROR_FORMAT_RESERVED",
  "BROTLI_DECODER_ERROR_FORMAT_EXUBERANT_META_NIBBLE",
  "BROTLI_DECODER_ERROR_FORMAT_SIMPLE_HUFFMAN_ALPHABET",
  "BROTLI_DECODER_ERROR_FORMAT_SIMPLE_HUFFMAN_SAME",
  "BROTLI_DECODER_ERROR_FORMAT_CL_SPACE",
  "BROTLI_DECODER_ERROR_FORMAT_HUFFMAN_SPACE",
  "BROTLI_DECODER_ERROR_FORMAT_CONTEXT_MAP_REPEAT",
  "BROTLI_DECODER_ERROR_FORMAT_BLOCK_LENGTH_1",
  "BROTLI_DECODER_ERROR_FORMAT_BLOCK_LENGTH_2",
  "BROTLI_DECODER_ERROR_FORMAT_TRANSFORM",
  "BROTLI_DECODER_ERROR_FORMAT_DICTIONARY",
  "BROTLI_DECODER_ERROR_FORMAT_WINDOW_BITS",
  "BROTLI_DECODER_ERROR_FORMAT_PADDING_1",
  "BROTLI_DECODER_ERROR_FORMAT_PADDING_2",
  "BROTLI_DECODER_ERROR_FORMAT_DISTANCE",
  "BROTLI_DECODER_ERROR_DICTIONARY_NOT_SET",
  "BROTLI_DECODER_ERROR_INVALID_ARGUMENTS",
  "BROTLI_DECODER_ERROR_ALLOC_CONTEXT_MODES",
  "BROTLI_DECODER_ERROR_ALLOC_TREE_GROUPS",
  "BROTLI_DECODER_ERROR_ALLOC_CONTEXT_MAP",
  "BROTLI_DECODER_ERROR_ALLOC_RING_BUFFER_1",
  "BROTLI_DECODER_ERROR_ALLOC_RING_BUFFER_2",
  "BROTLI_DECODER_ERROR_ALLOC_BLOCK_TYPE_TREES",
  "BROTLI_DECODER_ERROR_UNREACHABLE",
  "ZSTD_e_continue",
  "ZSTD_e_flush",
  "ZSTD_e_end",
  "ZSTD_fast",
  "ZSTD_dfast",
  "ZSTD_greedy",
  "ZSTD_lazy",
  "ZSTD_lazy2",
  "ZSTD_btlazy2",
  "ZSTD_btopt",
  "ZSTD_btultra",
  "ZSTD_btultra2",
  "ZSTD_c_compressionLevel",
  "ZSTD_c_windowLog",
  "ZSTD_c_hashLog",
  "ZSTD_c_chainLog",
  "ZSTD_c_searchLog",
  "ZSTD_c_minMatch",
  "ZSTD_c_targetLength",
  "ZSTD_c_strategy",
  "ZSTD_c_enableLongDistanceMatching",
  "ZSTD_c_ldmHashLog",
  "ZSTD_c_ldmMinMatch",
  "ZSTD_c_ldmBucketSizeLog",
  "ZSTD_c_ldmHashRateLog",
  "ZSTD_c_contentSizeFlag",
  "ZSTD_c_checksumFlag",
  "ZSTD_c_dictIDFlag",
  "ZSTD_c_nbWorkers",
  "ZSTD_c_jobSize",
  "ZSTD_c_overlapLog",
  "ZSTD_d_windowLogMax",
  "ZSTD_CLEVEL_DEFAULT",
  "ZSTD_error_no_error",
  "ZSTD_error_GENERIC",
  "ZSTD_error_prefix_unknown",
  "ZSTD_error_version_unsupported",
  "ZSTD_error_frameParameter_unsupported",
  "ZSTD_error_frameParameter_windowTooLarge",
  "ZSTD_error_corruption_detected",
  "ZSTD_error_checksum_wrong",
  "ZSTD_error_literals_headerWrong",
  "ZSTD_error_dictionary_corrupted",
  "ZSTD_error_dictionary_wrong",
  "ZSTD_error_dictionaryCreation_failed",
  "ZSTD_error_parameter_unsupported",
  "ZSTD_error_parameter_combination_unsupported",
  "ZSTD_error_parameter_outOfBound",
  "ZSTD_error_tableLog_tooLarge",
  "ZSTD_error_maxSymbolValue_tooLarge",
  "ZSTD_error_maxSymbolValue_tooSmall",
  "ZSTD_error_stabilityCondition_notRespected",
  "ZSTD_error_stage_wrong",
  "ZSTD_error_init_missing",
  "ZSTD_error_memory_allocation",
  "ZSTD_error_workSpace_tooSmall",
  "ZSTD_error_dstSize_tooSmall",
  "ZSTD_error_srcSize_wrong",
  "ZSTD_error_dstBuffer_null",
  "ZSTD_error_noForwardProgress_destFull",
  "ZSTD_error_noForwardProgress_inputEmpty",
];

const codeNames = [
  "0",
  "1",
  "2",
  "Z_OK",
  "Z_STREAM_END",
  "Z_NEED_DICT",
  "Z_ERRNO",
  "Z_STREAM_ERROR",
  "Z_DATA_ERROR",
  "Z_MEM_ERROR",
  "Z_BUF_ERROR",
  "Z_VERSION_ERROR",
  "-1",
  "-2",
  "-3",
  "-4",
  "-5",
  "-6",
];

let instantiationWarningEmitted = false;

function callableConstructor(Implementation, name) {
  // A compiled module may not publish this yet. Reaching through an absent
  // export turns "one export is missing" into "the module did not load" -- one
  // message for every test in the module, naming nothing.
  if (Implementation === undefined) return undefined;
  const callable = function (...args) {
    if (new.target === undefined) {
      // Node deduplicates deprecation warnings by code. DEP0184 belongs only
      // to these zlib constructors, so all nine wrappers share one flag.
      if (!instantiationWarningEmitted) {
        instantiationWarningEmitted = true;
        process.emitWarning(
          `Instantiating ${name} without the 'new' keyword has been deprecated.`,
          "DeprecationWarning",
          "DEP0184",
          callable,
        );
      }
      return new Implementation(...args);
    }
    return Reflect.construct(
      Implementation,
      args,
      new.target === callable ? Implementation : new.target,
    );
  };
  Object.setPrototypeOf(callable, Implementation);
  callable.prototype = Implementation.prototype;
  Object.defineProperties(callable, {
    length: { value: 1, configurable: true },
    name: { value: name, configurable: true },
  });
  Implementation.prototype.constructor = callable;
  return callable;
}
//
// `codes` and `constants` are defined read-only rather than copied, because
// node's are and its test checks: `zlib.codes = {}` has to throw, not just
// `zlib.codes.Z_OK = 1`. A table describing a file format is not something a
// program should be able to replace.
export function shape(exports) {
  const implementations = { ...exports };
  for (const name of legacyConstructorNames) {
    implementations[name] = callableConstructor(exports[name], name);
  }
  for (const name of implementationExportNames) delete implementations[name];
  for (const name of factoryNames) {
    Object.defineProperty(implementations, name, {
      value: exports[name],
      enumerable: true,
      writable: false,
      configurable: true,
    });
  }
  const constants = Object.create(null);
  // A compiled module may not publish `constants` yet -- see the note on
  // callableConstructor above.
  for (const name of exports.constants === undefined ? [] : constantNames) {
    Object.defineProperty(constants, name, {
      value: exports.constants[name],
      enumerable: true,
    });
  }
  const codeTable = {};
  for (const name of exports.codes === undefined ? [] : codeNames) codeTable[name] = exports.codes[name];
  const codes = Object.freeze(codeTable);
  delete implementations.default;
  delete implementations.iter;
  delete implementations.zlibCodeForStatus;

  const zlib = {};
  for (const name of publicExportNames) {
    const descriptor = Object.getOwnPropertyDescriptor(implementations, name);
    if (descriptor !== undefined) Object.defineProperty(zlib, name, descriptor);
  }
  for (const name of ["constants", "codes"]) {
    Object.defineProperty(zlib, name, {
      value: name === "codes" ? codes : constants,
      enumerable: true,
      writable: false,
      configurable: false,
    });
  }
  for (const [name, value] of Object.entries(constants)) {
    if (name.startsWith("BROTLI")) continue;
    Object.defineProperty(zlib, name, { value });
  }
  return zlib;
}

export function subpaths(exports) {
  return { "zlib/iter": exports.iter };
}
