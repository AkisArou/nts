function invalidType(name, kind, value, property = false) {
  const error = new TypeError(
    `The "${name}" ${property ? "property" : "argument"} must be of type ${kind}. ` +
    `Received ${value === null ? "null" : String(value)}`,
  );
  error.code = "ERR_INVALID_ARG_TYPE";
  return error;
}

/**
 * `util.inherits` is exactly a prototype mutation, so it belongs at this
 * JavaScript host boundary and never in the compiled TypeScript object model.
 */
function inherits(ctor, superCtor) {
  if (ctor === undefined || ctor === null) {
    throw invalidType("ctor", "function", ctor);
  }
  if (superCtor === undefined || superCtor === null) {
    throw invalidType("superCtor", "function", superCtor);
  }
  if (superCtor.prototype === undefined) {
    throw invalidType("superCtor.prototype", "object", undefined, true);
  }
  Object.defineProperty(ctor, "super_", {
    value: superCtor,
    writable: true,
    configurable: true,
  });
  Object.setPrototypeOf(ctor.prototype, superCtor.prototype);
}

function shapePromisify(compiled) {
  const custom = Symbol.for("nodejs.util.promisify.custom");
  const promisify = function promisify(original) {
    if (typeof original !== "function") {
      return compiled(original);
    }
    const implementation = original[custom];
    if (implementation !== undefined) {
      if (typeof implementation !== "function") {
        throw invalidType("util.promisify.custom", "function", implementation);
      }
      return implementation;
    }

    const wrapped = compiled(original);
    Object.setPrototypeOf(wrapped, Object.getPrototypeOf(original));
    Object.defineProperty(wrapped, custom, {
      value: wrapped,
      configurable: true,
    });
    return wrapped;
  };
  promisify.custom = custom;
  return promisify;
}

function shapeCallbackify(compiled) {
  return function callbackify(original) {
    const wrapped = compiled(original);
    const descriptors = Object.getOwnPropertyDescriptors(original);
    if (typeof descriptors.length?.value === "number") {
      descriptors.length.value++;
    }
    if (typeof descriptors.name?.value === "string") {
      descriptors.name.value += "Callbackified";
    }
    Object.defineProperties(wrapped, descriptors);
    return wrapped;
  };
}

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

export function shape(exports) {
  const util = { ...exports };
  delete util.default;
  util.inherits = inherits;
  util.promisify = shapePromisify(exports.promisify);
  util.callbackify = shapeCallbackify(exports.callbackify);
  // The live object, not a copy: node's tests set
  // `util.inspect.defaultOptions.numericSeparator = true` and expect `format`
  // to honour it on the next call.
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
