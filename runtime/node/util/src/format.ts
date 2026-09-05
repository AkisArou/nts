// `util.format`, node `lib/internal/util/inspect.js`.
//
// What `console.log` does with its arguments: substitute the format specifiers
// in the first argument, then append whatever is left over.

import { formatBigInt, formatNumber, inspect, inspectDefaultOptions, type InspectOptions } from "./inspect.ts";

/**
 * `%s` inspects objects whose string conversion is not statically known.
 *
 * Node decides whether to call `toString` / `Symbol.toPrimitive` by walking the
 * prototype chain. Letting the host's `String(value)` perform that discovery
 * would make the TypeScript test lane implement behavior the compiled runtime
 * intentionally cannot observe. Statically known primitive conversions stay
 * in the caller; every object and function takes the deterministic inspect
 * path here.
 */
function formatStringValue(value: unknown, options: InspectOptions): string {
  return inspect(value, { ...options, depth: 0, colors: false, compact: 3 });
}

/** `%j`, which has to survive a cycle rather than throwing. */
function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "undefined";
  } catch {
    return "[Circular]";
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
          else if (
            (typeof value === "object" && value !== null) ||
            typeof value === "function"
          )
            replacement = formatStringValue(value, options);
          // A number goes through `formatNumber` so that `-0` keeps its sign
          // and `numericSeparator` applies, which `String` does neither of.
          else if (typeof value === "number") replacement = formatNumber(value, options.numericSeparator ?? false);
          else replacement = String(value);
          break;
        }
        case 100: { // d
          // `formatNumber`, not `String`: `%d` of `-0` is `-0`, and `String`
          // loses the sign.
          const value = args[a];
          replacement = typeof value === "bigint" ? formatBigInt(value, options.numericSeparator ?? false)
            : typeof value === "symbol" ? "NaN"
            : formatNumber(Number(value), options.numericSeparator ?? false);
          break;
        }
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
          replacement = inspect(args[a], { ...options, showHidden: true, depth: 4 });
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
