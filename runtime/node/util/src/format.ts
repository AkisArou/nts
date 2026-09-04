// `util.format`, node `lib/internal/util/inspect.js`.
//
// What `console.log` does with its arguments: substitute the format specifiers
// in the first argument, then append whatever is left over.

import { formatBigInt, formatNumber, inspect, inspectDefaultOptions, type InspectOptions } from "./inspect.ts";

/**
 * The global constructors, by name. Node `lib/internal/util/inspect.js`.
 *
 * Read off `globalThis` rather than listed, so that it stays correct as the
 * language grows one.
 */
const builtInObjects = new Set(
  Object.getOwnPropertyNames(globalThis).filter((name) => /^[A-Z][a-zA-Z0-9]+$/.test(name)),
);

function returnFalse(): boolean {
  return false;
}

/**
 * Whether `%s` should inspect `value` rather than call `String` on it, upstream
 * `hasBuiltInToString`.
 *
 * An object that defines its own way of becoming a string -- `toString` or
 * `Symbol.toPrimitive`, its own or inherited from a class of its own -- is
 * asking to be printed that way. One still relying on a built-in's is not:
 * `[object Object]` tells a reader nothing, and `inspect` tells them
 * everything.
 *
 * The two `hasOwn` variables are how node decides *which* of the two
 * properties the prototype walk is looking for. If `value` has no callable
 * `toString` at all, only `Symbol.toPrimitive` counts; if it has no
 * `Symbol.toPrimitive`, only `toString` does. Swapping the unwanted one for a
 * function that always says no is neater than a flag in the loop.
 */
function hasBuiltInToString(value: object): boolean {
  type HasOwn = (target: object, key: PropertyKey) => boolean;
  const hasOwnProperty: HasOwn = (target, key) => Object.hasOwn(target, key);
  let hasOwnToString: HasOwn = hasOwnProperty;
  let hasOwnToPrimitive: HasOwn = hasOwnProperty;

  const holder = value as Record<PropertyKey, unknown>;
  if (typeof holder["toString"] !== "function") {
    if (typeof holder[Symbol.toPrimitive] !== "function") {
      // Neither: there is nothing to call, so `String(value)` would throw.
      return true;
    } else if (Object.hasOwn(value, Symbol.toPrimitive)) {
      return false;
    }
    hasOwnToString = returnFalse;
  } else if (Object.hasOwn(value, "toString")) {
    return false;
  } else if (typeof holder[Symbol.toPrimitive] !== "function") {
    hasOwnToPrimitive = returnFalse;
  } else if (Object.hasOwn(value, Symbol.toPrimitive)) {
    return false;
  }

  // Whoever owns the property first in the chain decides. The walk terminates
  // because `Object.prototype` has `toString`, and a chain that does not reach
  // it was answered above.
  let pointer: object = value;
  do {
    pointer = Object.getPrototypeOf(pointer) as object;
  } while (
    pointer !== null &&
    !hasOwnToString(pointer, "toString") &&
    !hasOwnToPrimitive(pointer, Symbol.toPrimitive)
  );

  if (pointer === null) {
    return true;
  }
  const descriptor = Object.getOwnPropertyDescriptor(pointer, "constructor");
  return descriptor !== undefined &&
    typeof descriptor.value === "function" &&
    builtInObjects.has((descriptor.value as { name: string }).name);
}

/** `%j`, which has to survive a cycle rather than throwing. */
function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "undefined";
  } catch (err) {
    return (err as Error)?.message?.includes("circular") ? "[Circular]" : "[Circular]";
  }
}

export function formatWithOptions(options: InspectOptions, ...args: unknown[]): string {
  // The module defaults underneath the caller's options, because
  // `util.inspect.defaultOptions` is documented to affect `format` too.
  options = { ...inspectDefaultOptions, ...options };
  const first = args[0];
  let out = "";
  let a = 0;

  if (typeof first === "string") {
    if (args.length === 1) {
      return first;
    }
    let lastPos = 0;
    a = 1;
    for (let i = 0; i < first.length - 1; i++) {
      if (first.charCodeAt(i) !== 37 /* % */) {
        continue;
      }
      const next = first.charCodeAt(i + 1);
      // Only a specifier with an argument left to consume is substituted;
      // `format('%s')` with nothing to fill it keeps the `%s`.
      if (next === 37 /* %% */) {
        out += first.slice(lastPos, i);
        lastPos = i + 1;
        i++;
        continue;
      }
      if (a >= args.length) {
        continue;
      }
      let replacement: string | undefined;
      switch (next) {
        case 115: { // s
          const value = args[a];
          if (typeof value === "bigint") replacement = formatBigInt(value, options.numericSeparator ?? false);
          // An object that defines its own `toString` is asking to be printed
          // that way; only one still using `Object.prototype`'s gets inspected,
          // since `[object Object]` tells a reader nothing.
          else if (typeof value === "object" && value !== null && hasBuiltInToString(value))
            replacement = inspect(value, { ...options, depth: 0, colors: false, compact: 3 });
          // A number goes through `formatNumber` so that `-0` keeps its sign
          // and `numericSeparator` applies, which `String` does neither of.
          else if (typeof value === "number") replacement = formatNumber(value, options.numericSeparator ?? false);
          else replacement = String(value);
          break;
        }
        case 100: // d
          // `formatNumber`, not `String`: `%d` of `-0` is `-0`, and `String`
          // loses the sign.
          replacement = typeof args[a] === "bigint" ? formatBigInt(args[a] as bigint, options.numericSeparator ?? false)
            : typeof args[a] === "symbol" ? "NaN"
            : formatNumber(Number(args[a]), options.numericSeparator ?? false);
          break;
        case 105: { // i
          const value = args[a];
          replacement = typeof value === "bigint" ? formatBigInt(value, options.numericSeparator ?? false)
            : typeof value === "symbol" ? "NaN"
            : formatNumber(Number.parseInt(String(value), 10), options.numericSeparator ?? false);
          break;
        }
        case 102: { // f
          const value = args[a];
          replacement = typeof value === "symbol" ? "NaN"
            : formatNumber(Number.parseFloat(String(value)), options.numericSeparator ?? false);
          break;
        }
        case 106: // j
          replacement = safeJson(args[a]);
          break;
        case 111: // o
          replacement = inspect(args[a], { ...options, showHidden: true, showProxy: true, depth: 4 } as InspectOptions);
          break;
        case 79: // O
          replacement = inspect(args[a], options);
          break;
        case 99: // c — a CSS directive, which a terminal has no use for
          replacement = "";
          break;
        default:
          continue;
      }
      out += first.slice(lastPos, i) + replacement;
      lastPos = i + 2;
      i++;
      a++;
    }
    if (lastPos !== 0) {
      out += first.slice(lastPos);
    } else {
      out = first;
    }
  }

  // Anything not consumed by a specifier is appended, inspected unless it is
  // already a string.
  for (; a < args.length; a++) {
    const value = args[a];
    out += (out === "" && a === 0 ? "" : " ") + (typeof value === "string" ? value : inspect(value, options));
  }
  return out;
}

export function format(...args: unknown[]): string {
  return formatWithOptions({}, ...args);
}
