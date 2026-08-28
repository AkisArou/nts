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
  } as Context;
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

function formatPrimitive(value: unknown, numericSeparator = false): string | undefined {
  switch (typeof value) {
    case "string": return quoteString(value);
    case "number": return formatNumber(value, numericSeparator);
    case "bigint": return formatBigInt(value, numericSeparator);
    case "boolean": return String(value);
    case "undefined": return "undefined";
    case "symbol": return value.toString();
    default: return value === null ? "null" : undefined;
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
  const primitive = formatPrimitive(value, ctx.numericSeparator);
  if (primitive !== undefined) {
    return primitive;
  }
  if (typeof value === "function") {
    return formatWithKeys(ctx, value as object, recurseTimes, functionLabel(value as never), ["{", "}"], []);
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

function formatObject(ctx: Context, value: object, recurseTimes: number): string {
  // A cycle: mark it and stop. Node numbers the reference so a reader can see
  // which object it points back to.
  if (ctx.seen.includes(value)) {
    let index = ctx.circular.get(value);
    if (index === undefined) {
      index = ctx.circular.size + 1;
      ctx.circular.set(value, index);
    }
    return `[Circular *${index}]`;
  }

  if (isDate(value)) {
    return Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString();
  }
  if (isRegExp(value)) {
    return String(value);
  }
  if (value instanceof Error) {
    return formatError(value);
  }
  if (isBoxedPrimitive(value)) {
    const wrapped = (value as { valueOf(): unknown }).valueOf();
    return `[${typeof wrapped === "string" ? "String" : typeof wrapped === "number" ? "Number"
      : typeof wrapped === "boolean" ? "Boolean" : typeof wrapped === "bigint" ? "BigInt" : "Symbol"}: ${
      formatPrimitive(wrapped)}]`;
  }

  const depthReached = ctx.depth !== null && recurseTimes > ctx.depth;
  if (depthReached) {
    if (Array.isArray(value)) return "[Array]";
    const name = constructorName(value);
    return name && name !== "[Object: null prototype]" ? `[${name}]` : "[Object]";
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
      entries.push(formatNumber(array[i]!, ctx.numericSeparator));
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
      entries.push(`<${end - i} empty item${end - i > 1 ? "s" : ""}>`);
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
      output.push(`${formatKey(key)}: ${formatProperty(ctx, value, key, recurseTimes)}`);
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

function formatKey(key: PropertyKey): string {
  if (typeof key === "symbol") {
    return `[${key.toString()}]`;
  }
  // An identifier needs no quotes; anything else does.
  return /^[A-Za-z_$][\w$]*$/.test(String(key)) ? String(key) : quoteString(String(key));
}

function formatProperty(ctx: Context, value: object, key: PropertyKey, recurseTimes: number): string {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined) {
    return "undefined";
  }
  if (descriptor.get !== undefined) {
    // Calling a getter to print it would run arbitrary code as a side effect
    // of logging, so node names it instead unless asked.
    if (ctx.getters === true || ctx.getters === "get") {
      try {
        return formatValue(ctx, descriptor.get.call(value), recurseTimes + 1);
      } catch {
        return "[Getter: <Inspection threw>]";
      }
    }
    return descriptor.set === undefined ? "[Getter]" : "[Getter/Setter]";
  }
  if (descriptor.set !== undefined) {
    return "[Setter]";
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
