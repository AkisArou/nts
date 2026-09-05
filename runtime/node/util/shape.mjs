const COLOR_ALIASES = [
  ["gray", "grey"],
  ["gray", "blackBright"],
  ["bgGray", "bgGrey"],
  ["bgGray", "bgBlackBright"],
  ["dim", "faint"],
  ["strikethrough", "crossedout"],
  ["strikethrough", "strikeThrough"],
  ["strikethrough", "crossedOut"],
  ["hidden", "conceal"],
  ["inverse", "swapColors"],
  ["inverse", "swapcolors"],
  ["doubleunderline", "doubleUnderline"],
];

/**
 * Install Node's public alias properties on `util.inspect.colors`.
 *
 * This is representation shaping only. The typed `styleText` implementation
 * already recognizes every alias itself; changing this host object cannot add
 * an operation to the compiled module.
 */
function installColorAliases(colors) {
  for (const [target, alias] of COLOR_ALIASES) {
    Object.defineProperty(colors, alias, {
      get() { return colors[target]; },
      set(value) { colors[target] = value; },
      configurable: true,
      enumerable: false,
    });
  }
}

/** Assemble Node's CommonJS export shape from the typed module exports. */
export function shape(exports) {
  const util = { ...exports };
  delete util.default;

  // These are Node's public properties on the `inspect` function. The values
  // remain the live typed tables used by `inspect`, `format`, and `styleText`.
  util.inspect.defaultOptions = exports.inspectDefaultOptions;
  util.inspect.colors = exports.colors;
  util.inspect.styles = exports.styles;
  util.inspect.custom = Symbol.for("nodejs.util.inspect.custom");
  installColorAliases(exports.colors);

  delete util.inspectDefaultOptions;
  delete util.colors;
  delete util.styles;
  return util;
}

/** Node exposes the same fixed `types` object at `node:util/types`. */
export function subpaths(exports) {
  return { "util/types": exports.types };
}
