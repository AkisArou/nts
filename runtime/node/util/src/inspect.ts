// `util.inspect`, node `lib/internal/util/inspect.js`.
//
// What `console.log` prints for anything that is not a string, what an
// assertion diff is built from, and what several error messages embed. Its
// output is not decorative: node's own tests compare against it exactly, so the
// spacing, the quoting and the line-breaking are all part of the contract.
//
// The line-breaking rule is the part that looks arbitrary and is not. Short
// collections stay on one line; anything past the break length, or with more
// than six entries, goes one entry per line. That is upstream's
// `reduceToSingleString`, and matching it is most of matching node's output.

import {
  isAnyArrayBuffer, isArrayBufferView, isBoxedPrimitive, isDate, isMap,
  isRegExp, isSet, isTypedArray,
} from "./types.ts";

/**
 * The symbol an object defines to render itself, upstream
 * `lib/internal/util/inspect.js`.
 *
 * `Buffer` uses it to print `<Buffer 78 79 7a>` rather than a list of byte
 * values, which is the difference between a readable log line and forty
 * numbers.
 */
export const customInspectSymbol: unique symbol = Symbol.for("nodejs.util.inspect.custom") as never;

/**
 * The style names `inspect` asks for, and the colour each maps to.
 *
 * Two tables rather than one because both are public and mutable: a program
 * can rename a style's colour (`util.inspect.styles.string = 'cyan'`) or add a
 * colour of its own (`util.inspect.colors.orange = [38, 39]`), and node's own
 * tests do both.
 */
export type StyleType =
  | "special" | "number" | "bigint" | "boolean" | "undefined" | "null"
  | "string" | "symbol" | "date" | "regexp" | "module" | "name";

export const inspectStyles: Record<string, string | undefined> = {
  __proto__: null,
  special: "cyan",
  number: "yellow",
  bigint: "yellow",
  boolean: "yellow",
  undefined: "grey",
  null: "bold",
  string: "green",
  symbol: "green",
  date: "magenta",
  // `name` is deliberately unstyled: a key is not a value.
  regexp: "red",
  module: "underline",
} as never;

/**
 * ANSI codes by name. Each is the pair that turns the style on and off --
 * `[31, 39]` for red -- because a nested style has to restore the outer one
 * rather than reset everything.
 */
export const inspectColors: Record<string, [number, number] | undefined> = {
  __proto__: null,
  reset: [0, 0], bold: [1, 22], dim: [2, 22], italic: [3, 23], underline: [4, 24],
  blink: [5, 25], inverse: [7, 27], hidden: [8, 28], strikethrough: [9, 29],
  doubleunderline: [21, 24],
  black: [30, 39], red: [31, 39], green: [32, 39], yellow: [33, 39],
  blue: [34, 39], magenta: [35, 39], cyan: [36, 39], white: [37, 39],
  bgBlack: [40, 49], bgRed: [41, 49], bgGreen: [42, 49], bgYellow: [43, 49],
  bgBlue: [44, 49], bgMagenta: [45, 49], bgCyan: [46, 49], bgWhite: [47, 49],
  framed: [51, 54], overlined: [53, 55],
  gray: [90, 39], grey: [90, 39],
  redBright: [91, 39], greenBright: [92, 39], yellowBright: [93, 39],
  blueBright: [94, 39], magentaBright: [95, 39], cyanBright: [96, 39],
  whiteBright: [97, 39],
  bgGray: [100, 49], bgGrey: [100, 49],
  bgRedBright: [101, 49], bgGreenBright: [102, 49], bgYellowBright: [103, 49],
  bgBlueBright: [104, 49], bgMagentaBright: [105, 49], bgCyanBright: [106, 49],
  bgWhiteBright: [107, 49],
} as never;

/**
 * The names node accepts as spellings of an existing colour.
 *
 * Getters rather than copies, so that a program changing `colors.gray` changes
 * `colors.grey` with it, and non-enumerable so that listing the colours does
 * not list each one three times. `styleText` validates against
 * `getOwnPropertyNames`, which sees them regardless.
 */
for (const [target, alias] of [
  ["gray", "grey"], ["gray", "blackBright"],
  ["bgGray", "bgGrey"], ["bgGray", "bgBlackBright"],
  ["dim", "faint"],
  ["strikethrough", "crossedout"], ["strikethrough", "strikeThrough"],
  ["strikethrough", "crossedOut"],
  ["hidden", "conceal"],
  ["inverse", "swapColors"], ["inverse", "swapcolors"],
  ["doubleunderline", "doubleUnderline"],
] as const) {
  Object.defineProperty(inspectColors, alias, {
    __proto__: null,
    get(this: Record<string, [number, number] | undefined>) { return this[target]; },
    set(this: Record<string, [number, number] | undefined>, value: [number, number]) {
      this[target] = value;
    },
    configurable: true,
    enumerable: false,
  } as PropertyDescriptor);
}

/** What every piece of output goes through. The colourless one is the default. */
export type Stylize = (str: string, styleType: StyleType) => string;

export function stylizeNoColor(str: string): string {
  return str;
}

export function stylizeWithColor(str: string, styleType: StyleType): string {
  const style = inspectStyles[styleType];
  if (style !== undefined) {
    const color = inspectColors[style];
    if (color !== undefined) {
      return `\u001b[${color[0]}m${str}\u001b[${color[1]}m`;
    }
  }
  return str;
}

export interface InspectOptions {
  depth?: number | null;
  colors?: boolean;
  showHidden?: boolean;
  breakLength?: number;
  compact?: number | boolean;
  sorted?: boolean;
  maxArrayLength?: number | null;
  maxStringLength?: number | null;
  numericSeparator?: boolean;
  getters?: boolean | "get" | "set";
  customInspect?: boolean;
}

interface Context extends Required<Omit<InspectOptions, "depth" | "maxArrayLength" | "maxStringLength">> {
  depth: number | null;
  maxArrayLength: number | null;
  maxStringLength: number | null;
  indentationLvl: number;
  seen: object[];
  circular: Map<object, number>;
  /** The deepest recursion reached so far, for the `compact` rule below. */
  currentDepth: number;
  /** Colour, or the identity. Chosen once per `inspect` call. */
  stylize: Stylize;
}

/**
 * The module's defaults, and *mutable*: node exposes this as
 * `util.inspect.defaultOptions` and programs change it to set a depth or turn
 * on colours globally. `inspect` and `format` both read it at call time, so a
 * change takes effect on the next call rather than needing every caller to
 * pass an option through.
 */
export const inspectDefaultOptions: InspectOptions = {
  depth: 2,
  colors: false,
  showHidden: false,
  breakLength: 80,
  compact: 3,
  sorted: false,
  maxArrayLength: 100,
  maxStringLength: 10000,
  numericSeparator: false,
  getters: false,
  customInspect: true,
};

export function inspect(value: unknown, options?: InspectOptions | boolean): string {
  const settings: InspectOptions =
    typeof options === "boolean" ? { showHidden: options } : (options ?? {});
  const ctx: Context = {
    ...(inspectDefaultOptions as Required<InspectOptions>),
    ...settings,
    indentationLvl: 0,
    seen: [],
    circular: new Map(),
    currentDepth: 0,
    // Chosen once, so that every piece of output goes through the same
    // function and a nested value cannot end up coloured differently from the
    // one containing it.
    stylize: stylizeNoColor as Stylize,
  } as Context;
  if (ctx.colors) {
    ctx.stylize = stylizeWithColor;
  }
  return formatValue(ctx, value, 0);
}

/** `'it'`, `"it's"`, `` `both ' and "` `` — node prefers the quote needing least escaping. */
export function quoteString(str: string): string {
  const escaped = str
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/\x08/g, "\\b")
    .replace(/\f/g, "\\f")
    .replace(/\v/g, "\\v")
    // Everything else below space, and the delete character.
    .replace(/[\x00-\x07\x0e-\x1f\x7f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`);

  if (!escaped.includes("'")) {
    return `'${escaped}'`;
  }
  if (!escaped.includes('"')) {
    return `"${escaped}"`;
  }
  if (!escaped.includes("`")) {
    return `\`${escaped}\``;
  }
  return `'${escaped.replace(/'/g, "\\'")}'`;
}

/**
 * Digit groups from the right: `118_059_162`. Node `lib/internal/util/inspect.js`.
 * Only under `numericSeparator`, which is off by default.
 */
function addSeparators(digits: string): string {
  let result = "";
  let i = digits.length;
  const start = digits.startsWith("-") ? 1 : 0;
  for (; i >= start + 4; i -= 3) {
    result = `_${digits.slice(i - 3, i)}${result}`;
  }
  return i === digits.length ? digits : `${digits.slice(0, i)}${result}`;
}

/** The same, from the left, for the fractional part. */
function addSeparatorsAfterPoint(digits: string): string {
  let result = "";
  let i = 0;
  for (; i < digits.length - 3; i += 3) {
    result += `${digits.slice(i, i + 3)}_`;
  }
  return i === 0 ? digits : `${result}${digits.slice(i)}`;
}

/** A bigint, with digit groups under `numericSeparator`. */
export function formatBigInt(value: bigint, numericSeparator = false): string {
  const digits = String(value);
  return `${numericSeparator ? addSeparators(digits) : digits}n`;
}

export function formatNumber(value: number, numericSeparator = false): string {
  if (!numericSeparator) {
    // `-0` prints as `-0`, which `String(-0)` does not do and which is the
    // whole reason `Object.is` exists.
    return Object.is(value, -0) ? "-0" : String(value);
  }
  const integer = Math.trunc(value);
  const asString = String(integer);
  if (integer === value) {
    // Exponential notation has no digit groups to insert into.
    if (!Number.isFinite(value) || asString.includes("e")) {
      return asString;
    }
    return addSeparators(asString);
  }
  if (Number.isNaN(value)) {
    return asString;
  }
  return `${addSeparators(asString)}.${
    addSeparatorsAfterPoint(String(value).slice(asString.length + 1))
  }`;
}

function formatPrimitive(
  stylize: Stylize,
  value: unknown,
  numericSeparator = false,
): string | undefined {
  switch (typeof value) {
    case "string": return stylize(quoteString(value), "string");
    case "number": return stylize(formatNumber(value, numericSeparator), "number");
    case "bigint": return stylize(formatBigInt(value, numericSeparator), "bigint");
    case "boolean": return stylize(String(value), "boolean");
    case "undefined": return stylize("undefined", "undefined");
    case "symbol": return stylize(value.toString(), "symbol");
    default: return value === null ? stylize("null", "null") : undefined;
  }
}

function functionLabel(value: (...args: never[]) => unknown): string {
  const isClass = /^\s*class[\s{]/.test(Function.prototype.toString.call(value));
  const name = value.name;
  if (isClass) {
    return name ? `[class ${name}]` : "[class (anonymous)]";
  }
  return name ? `[Function: ${name}]` : "[Function (anonymous)]";
}

function formatValue(ctx: Context, value: unknown, recurseTimes: number): string {
  const primitive = formatPrimitive(ctx.stylize, value, ctx.numericSeparator);
  if (primitive !== undefined) {
    return primitive;
  }
  if (typeof value === "function") {
    const label = ctx.stylize(functionLabel(value as never), "special");
    return formatWithKeys(ctx, value as object, recurseTimes, label, ["{", "}"], []);
  }
  return formatObject(ctx, value as object, recurseTimes);
}

function constructorName(value: object): string | undefined {
  const proto = Object.getPrototypeOf(value);
  if (proto === null) {
    return "[Object: null prototype]";
  }
  const name = proto.constructor?.name;
  return name === "Object" ? undefined : name;
}

/**
 * A revoked proxy answers no internal method: reading a property, taking its
 * prototype, listing its keys all throw. There is nothing to print and no way
 * to look, so node prints a placeholder.
 *
 * Node asks the engine (`getProxyDetails`) whether it really is one. We cannot,
 * so the test is behavioural: an object that throws on `isExtensible` is
 * treated as revoked. A live proxy whose handler throws for every trap is
 * indistinguishable from a revoked one at the language level, and would be
 * reported the same way.
 */
function isRevokedProxy(value: object): boolean {
  try {
    Object.isExtensible(value);
    return false;
  } catch {
    return true;
  }
}

function formatObject(ctx: Context, value: object, recurseTimes: number): string {
  if (isRevokedProxy(value)) {
    return ctx.stylize("<Revoked Proxy>", "special");
  }

  // An object that knows how to render itself is asked first, before any of
  // the shape detection below.
  if (ctx.customInspect) {
    const custom = (value as Record<symbol, unknown>)[customInspectSymbol];
    if (typeof custom === "function" && custom !== inspect) {
      const rendered = (custom as (d: number, o: InspectOptions, i: typeof inspect) => unknown)
        .call(value, ctx.depth === null ? null as never : ctx.depth - recurseTimes, ctx, inspect);
      return typeof rendered === "string" ? rendered : formatValue(ctx, rendered, recurseTimes);
    }
  }

  // A cycle: mark it and stop. Node numbers the reference so a reader can see
  // which object it points back to.
  if (ctx.seen.includes(value)) {
    let index = ctx.circular.get(value);
    if (index === undefined) {
      index = ctx.circular.size + 1;
      ctx.circular.set(value, index);
    }
    return ctx.stylize(`[Circular *${index}]`, "special");
  }

  if (isDate(value)) {
    return ctx.stylize(
      Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString(),
      "date",
    );
  }
  if (isRegExp(value)) {
    return ctx.stylize(String(value), "regexp");
  }
  if (value instanceof Error) {
    return formatError(value);
  }
  if (isBoxedPrimitive(value)) {
    const wrapped = (value as { valueOf(): unknown }).valueOf();
    return `[${typeof wrapped === "string" ? "String" : typeof wrapped === "number" ? "Number"
      : typeof wrapped === "boolean" ? "Boolean" : typeof wrapped === "bigint" ? "BigInt" : "Symbol"}: ${
      formatPrimitive(ctx.stylize, wrapped)}]`;
  }

  const depthReached = ctx.depth !== null && recurseTimes > ctx.depth;
  if (depthReached) {
    if (Array.isArray(value)) return ctx.stylize("[Array]", "special");
    const name = constructorName(value);
    return ctx.stylize(
      name && name !== "[Object: null prototype]" ? `[${name}]` : "[Object]",
      "special",
    );
  }

  ctx.seen.push(value);
  // Set *after* the depth cut-off above: a child that was truncated to
  // `[Object]` never recursed, so it must not count towards how deep this
  // subtree goes. Counting it would push every parent onto multiple lines.
  ctx.currentDepth = recurseTimes;
  try {
    return formatByShape(ctx, value, recurseTimes);
  } finally {
    ctx.seen.pop();
  }
}

function formatByShape(ctx: Context, value: object, recurseTimes: number): string {
  if (Array.isArray(value)) {
    return formatWithKeys(ctx, value, recurseTimes, "", ["[", "]"], indented(ctx, () =>
      formatArrayEntries(ctx, value, recurseTimes)));
  }
  if (isTypedArray(value)) {
    const array = value as unknown as ArrayLike<number>;
    const label = `${value.constructor.name}(${array.length})`;
    const entries: string[] = [];
    const limit = ctx.maxArrayLength ?? array.length;
    for (let i = 0; i < Math.min(array.length, limit); i++) {
      entries.push(ctx.stylize(formatNumber(array[i]!, ctx.numericSeparator), "number"));
    }
    if (array.length > limit) {
      entries.push(`... ${array.length - limit} more item${array.length - limit > 1 ? "s" : ""}`);
    }
    return formatWithKeys(ctx, value, recurseTimes, label, ["[", "]"], entries);
  }
  if (isMap(value)) {
    const entries = indented(ctx, () =>
      [...value].map(
        ([k, v]) => `${formatValue(ctx, k, recurseTimes + 1)} => ${formatValue(ctx, v, recurseTimes + 1)}`,
      ));
    return formatWithKeys(ctx, value, recurseTimes, `Map(${value.size})`, ["{", "}"], entries);
  }
  if (isSet(value)) {
    const entries = indented(ctx, () => [...value].map((v) => formatValue(ctx, v, recurseTimes + 1)));
    return formatWithKeys(ctx, value, recurseTimes, `Set(${value.size})`, ["{", "}"], entries);
  }
  if (isAnyArrayBuffer(value)) {
    const bytes = new Uint8Array(value as ArrayBuffer);
    const shown = [...bytes.subarray(0, 50)].map((b) => b.toString(16).padStart(2, "0")).join(" ");
    return `ArrayBuffer { [Uint8Contents]: <${shown}${bytes.length > 50 ? " ..." : ""}>, byteLength: ${bytes.length} }`;
  }
  if (isArrayBufferView(value)) {
    return formatWithKeys(ctx, value, recurseTimes, value.constructor.name, ["{", "}"], []);
  }

  const name = constructorName(value);
  const prefix = name === undefined ? "" : name;
  return formatWithKeys(ctx, value, recurseTimes, prefix, ["{", "}"], []);
}

/** Run `body` one indentation level deeper, and put the level back after. */
function indented<T>(ctx: Context, body: () => T): T {
  ctx.indentationLvl += 2;
  try {
    return body();
  } finally {
    ctx.indentationLvl -= 2;
  }
}

function formatArrayEntries(ctx: Context, value: unknown[], recurseTimes: number): string[] {
  const entries: string[] = [];
  const limit = ctx.maxArrayLength ?? value.length;
  const shown = Math.min(value.length, limit);
  for (let i = 0; i < shown; i++) {
    // A hole is not `undefined`; node reports the run of them.
    if (!Object.prototype.hasOwnProperty.call(value, i)) {
      let end = i;
      while (end < shown && !Object.prototype.hasOwnProperty.call(value, end)) end++;
      entries.push(ctx.stylize(`<${end - i} empty item${end - i > 1 ? "s" : ""}>`, "undefined"));
      i = end - 1;
      continue;
    }
    entries.push(formatValue(ctx, value[i], recurseTimes + 1));
  }
  const remaining = value.length - shown;
  if (remaining > 0) {
    entries.push(`... ${remaining} more item${remaining > 1 ? "s" : ""}`);
  }
  return entries;
}

/** An error prints as its stack, with any own properties appended. */
function formatError(err: Error): string {
  const stack = err.stack;
  return typeof stack === "string" && stack.length > 0 ? stack : `[${err.name}: ${err.message}]`;
}

/**
 * The named properties of `value`, appended to `entries`, then wrapped in
 * `braces` with `base` in front.
 *
 * Array indices are skipped because they were already formatted as entries;
 * everything else — including symbol keys and, when asked, non-enumerable ones
 * — is printed as `key: value`.
 */
function formatWithKeys(
  ctx: Context,
  value: object,
  recurseTimes: number,
  base: string,
  braces: [string, string],
  entries: string[],
): string {
  const output = [...entries];
  const isArrayLike = Array.isArray(value) || isTypedArray(value);

  let keys: PropertyKey[] = ctx.showHidden
    ? Reflect.ownKeys(value)
    : Object.keys(value);
  if (!ctx.showHidden) {
    for (const symbol of Object.getOwnPropertySymbols(value)) {
      if (Object.prototype.propertyIsEnumerable.call(value, symbol)) {
        keys.push(symbol);
      }
    }
  }
  if (isArrayLike) {
    keys = keys.filter((k) => typeof k !== "string" || !/^\d+$/.test(k));
  }
  if (typeof value === "function") {
    keys = keys.filter((k) => k !== "length" && k !== "name" && k !== "prototype");
  }
  if (ctx.sorted) {
    keys.sort((a, b) => String(a).localeCompare(String(b)));
  }

  ctx.indentationLvl += 2;
  try {
    for (const key of keys) {
      output.push(formatProperty(ctx, value, key, recurseTimes));
    }
  } finally {
    ctx.indentationLvl -= 2;
  }

  if (output.length === 0) {
    // A function with no own properties is just its label: `[Function: foo]`,
    // not `[Function: foo] {}`.
    if (typeof value === "function") {
      return base;
    }
    // `[]`, `{}`, `Foo {}` — an empty collection stays on one line whatever
    // its label.
    return base ? `${base} ${braces[0]}${braces[1]}` : `${braces[0]}${braces[1]}`;
  }

  const marker = ctx.circular.get(value);
  const wrapped = reduceToSingleString(ctx, output, base, braces, isArrayLike, recurseTimes, value);
  return marker === undefined ? wrapped : `<ref *${marker}> ${wrapped}`;
}

/**
 * How a key is spelled, upstream `formatProperty`.
 *
 * A symbol prints as `Symbol(x)` with no brackets, an identifier bare, and
 * anything else quoted. `__proto__` is bracketed and quoted even though it is
 * an identifier, because `{ __proto__: ... }` in the printed output would mean
 * something else if it were pasted back in. Brackets around the whole name
 * mark a non-enumerable property, which is only ever reached under
 * `showHidden`.
 */
function formatKey(ctx: Context, key: PropertyKey, enumerable: boolean): string {
  let name: string;
  if (typeof key === "symbol") {
    name = ctx.stylize(key.toString(), "symbol");
  } else if (/^[a-zA-Z_][a-zA-Z_0-9]*$/.test(String(key))) {
    name = key === "__proto__" ? "['__proto__']" : ctx.stylize(String(key), "name");
  } else {
    name = ctx.stylize(quoteString(String(key)), "string");
  }
  return enumerable ? name : `[${name}]`;
}

/** `key: value` for one own property, with the key spelled as node spells it. */
function formatProperty(ctx: Context, value: object, key: PropertyKey, recurseTimes: number): string {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  const name = formatKey(ctx, key, descriptor?.enumerable !== false);
  return `${name}: ${formatPropertyValue(ctx, value, descriptor, recurseTimes)}`;
}

function formatPropertyValue(
  ctx: Context,
  value: object,
  descriptor: PropertyDescriptor | undefined,
  recurseTimes: number,
): string {
  if (descriptor === undefined) {
    return ctx.stylize("undefined", "undefined");
  }
  if (descriptor.get !== undefined) {
    // Calling a getter to print it would run arbitrary code as a side effect
    // of logging, so node names it instead unless asked.
    if (ctx.getters === true || ctx.getters === "get") {
      try {
        return formatValue(ctx, descriptor.get.call(value), recurseTimes + 1);
      } catch {
        return ctx.stylize("[Getter: <Inspection threw>]", "special");
      }
    }
    return ctx.stylize(descriptor.set === undefined ? "[Getter]" : "[Getter/Setter]", "special");
  }
  if (descriptor.set !== undefined) {
    return ctx.stylize("[Setter]", "special");
  }
  return formatValue(ctx, descriptor.value, recurseTimes + 1);
}

/**
 * One line when it fits, one entry per line when it does not.
 *
 * Upstream `reduceToSingleString`. The six-entry cap is not about width: an
 * object with many keys reads better stacked even when it would fit, and node
 * applies it to objects but not to arrays.
 */
function reduceToSingleString(
  ctx: Context,
  output: string[],
  base: string,
  braces: [string, string],
  isArrayLike: boolean,
  recurseTimes: number,
  value: object,
): string {
  if (ctx.compact !== false) {
    const limit = typeof ctx.compact === "number" ? ctx.compact : 3;
    let entries = output;
    if (isArrayLike && output.length > 6) {
      entries = groupArrayElements(ctx, output, value);
    }
    // `compact: 3` means "combine a subtree less than three levels deep". A
    // deeper one reads better stacked even when it would fit on a line, and
    // grouping having changed the entries rules out combining them again.
    if (
      limit >= 1 &&
      ctx.currentDepth - recurseTimes < limit &&
      entries.length === output.length
    ) {
      const start = output.length + ctx.indentationLvl + braces[0].length + base.length + 10;
      if (isBelowBreakLength(ctx, output, start, base)) {
        const joined = output.join(", ");
        if (!joined.includes("\n")) {
          return `${base ? `${base} ` : ""}${braces[0]} ${joined} ${braces[1]}`;
        }
      }
    }
    output = entries;
  }
  const indentation = `\n${" ".repeat(ctx.indentationLvl)}`;
  return `${base ? `${base} ` : ""}${braces[0]}${indentation}  ${
    output.join(`,${indentation}  `)
  }${indentation}${braces[1]}`;
}

/**
 * Lay short array entries out as a padded grid, node's `groupArrayElements`.
 *
 * Thirty numbers one per line is unreadable and thirty numbers on one line is
 * too wide, so node picks a column count from the entry widths and pads to it.
 * Numbers are right-aligned and everything else left-aligned, which is why the
 * original values are needed here and not just their rendered form.
 *
 * The column arithmetic is upstream's, constants included. It is a fitted
 * heuristic rather than a derivation, and changing it changes the output.
 */
function groupArrayElements(ctx: Context, output: string[], value: object): string[] {
  let totalLength = 0;
  let maxLength = 0;
  let i = 0;
  // A trailing "... n more items" is not part of the grid.
  const hasMore = output.length > 0 && output[output.length - 1]!.startsWith("... ");
  const outputLength = hasMore ? output.length - 1 : output.length;
  const separatorSpace = 2; // ", "
  const dataLen = new Array<number>(outputLength);

  for (; i < outputLength; i++) {
    const len = output[i]!.length;
    dataLen[i] = len;
    totalLength += len + separatorSpace;
    if (maxLength < len) maxLength = len;
  }

  const actualMax = maxLength + separatorSpace;
  if (
    actualMax * 3 + ctx.indentationLvl < ctx.breakLength &&
    (totalLength / actualMax > 5 || maxLength <= 6)
  ) {
    const approxCharHeights = 2.5;
    const averageBias = Math.sqrt(actualMax - totalLength / outputLength);
    const biasedMax = Math.max(actualMax - 3 - averageBias, 1);
    const columns = Math.min(
      Math.round(Math.sqrt(approxCharHeights * biasedMax * outputLength) / biasedMax),
      Math.floor((ctx.breakLength - ctx.indentationLvl) / actualMax),
      (typeof ctx.compact === "number" ? ctx.compact : 3) * 4,
      15,
    );
    if (columns <= 1) {
      return output;
    }

    const maxLineLength: number[] = [];
    for (let c = 0; c < columns; c++) {
      let lineLength = 0;
      for (let j = c; j < outputLength; j += columns) {
        if (dataLen[j]! > lineLength) lineLength = dataLen[j]!;
      }
      maxLineLength.push(lineLength + separatorSpace);
    }

    // Right-align a column of numbers, left-align anything else.
    let padStart = true;
    const items = value as unknown as ArrayLike<unknown>;
    for (let j = 0; j < outputLength; j++) {
      const item = items[j];
      if (typeof item !== "number" && typeof item !== "bigint") {
        padStart = false;
        break;
      }
    }

    const grouped: string[] = [];
    for (let start = 0; start < outputLength; start += columns) {
      const max = Math.min(start + columns, outputLength);
      let line = "";
      let j = start;
      for (; j < max - 1; j++) {
        const padding = maxLineLength[j - start]! + output[j]!.length - dataLen[j]!;
        const cell = `${output[j]}, `;
        line += padStart ? cell.padStart(padding, " ") : cell.padEnd(padding, " ");
      }
      if (padStart) {
        const padding = maxLineLength[j - start]! + output[j]!.length - dataLen[j]! - separatorSpace;
        line += output[j]!.padStart(padding, " ");
      } else {
        line += output[j];
      }
      grouped.push(line);
    }
    if (hasMore) {
      grouped.push(output[output.length - 1]!);
    }
    return grouped;
  }
  return output;
}

function isBelowBreakLength(ctx: Context, output: string[], start: number, base: string): boolean {
  let total = output.length + start;
  if (total + output.length > ctx.breakLength) {
    return false;
  }
  for (const entry of output) {
    if (entry.includes("\n")) {
      return false;
    }
    total += entry.length;
    if (total > ctx.breakLength) {
      return false;
    }
  }
  return base === "" || !base.includes("\n");
}
