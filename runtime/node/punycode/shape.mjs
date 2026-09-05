export function shape(exports) {
  // Preserve CommonJS's exact public key set and insertion order. The codec's
  // direct helpers are internal dependencies of node:url, not public aliases.
  return {
    version: exports.version,
    ucs2: exports.ucs2,
    decode: exports.decode,
    encode: exports.encode,
    toASCII: exports.toASCII,
    toUnicode: exports.toUnicode,
  };
}
