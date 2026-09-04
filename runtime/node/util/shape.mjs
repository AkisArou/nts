export function shape(exports) {
  const util = { ...exports };
  delete util.default;
  delete util.isDeepStrictEqualExport;
  // The live object, not a copy: node's tests set
  // `util.inspect.defaultOptions.numericSeparator = true` and expect `format`
  // to honour it on the next call.
  util.inspect.defaultOptions = exports.inspectDefaultOptions;
  util.inspect.custom = Symbol.for("nodejs.util.inspect.custom");
  util.promisify.custom = Symbol.for("nodejs.util.promisify.custom");
  return util;
}
