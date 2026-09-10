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
  // A compiled module may publish none of this yet. Reaching through an absent
  // export turns "one export is missing" into "the module did not load" -- one
  // message for every test, naming nothing. Guarded so each test fails saying
  // which export it wanted.
  if (util.inspect !== undefined) {
  util.inspect.defaultOptions = exports.inspectDefaultOptions;
  util.inspect.colors = exports.colors;
  util.inspect.styles = exports.styles;
  util.inspect.custom = Symbol.for("nodejs.util.inspect.custom");
  }
  if (exports.colors !== undefined) installColorAliases(exports.colors);

  // `main.ts` reaches the predicates with `import * as types`, so `exports.types`
  // is an **ESM module namespace object** and node's is an ordinary object. Four
  // things are observable about the difference, and all four were ours:
  //
  //                        node        here, before
  //     Symbol.toStringTag undefined   "Module"
  //     isExtensible       true        false
  //     prototype          Object.p    null
  //     types.isDate       configurable true   configurable false
  //
  // A namespace object is frozen and null-prototyped by specification, so no
  // amount of care on the TypeScript side changes it -- the shape is where it has
  // to be undone. Spread copies own *enumerable* keys, and `Symbol.toStringTag`
  // on a namespace is not enumerable, so it does not come across.
  //
  // Representation shaping only, in the sense this file uses everywhere else: the
  // predicates are the same function objects and nothing here can add an
  // operation to the compiled module.
  if (exports.types !== undefined) {
    util.types = { ...exports.types };
  }

  delete util.inspectDefaultOptions;
  delete util.colors;
  delete util.styles;
  return util;
}

/**
 * Node exposes the same fixed `types` object at `node:util/types`.
 *
 * `shaped.types` rather than `exports.types`: the shape rebuilds it as a plain
 * object, and `require('util/types') === require('util').types` has to keep
 * holding. Returning the raw namespace here would hand the subpath a different
 * object from the one the module publishes.
 */
export function subpaths(exports, shaped) {
  return { "util/types": shaped?.types ?? exports.types };
}
