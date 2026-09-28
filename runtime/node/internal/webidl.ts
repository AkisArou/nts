// Web IDL's conversions, from node v24.20.0 `lib/internal/webidl.js`: the
// JavaScript value a Web API receives, made into the IDL value its
// specification describes -- or the `TypeError` node words for one that
// cannot be.
//
// Node builds its converters as closures from factories (`createEnum...`,
// `createDictionary...`) at module scope. Here each converter is a function
// declaration and each factory a function its converters call, so nothing at
// module scope holds a closure; `converters()` makes node's table for the
// tests that read it.

import { isArrayBuffer, isSharedArrayBuffer, isTypedArray } from "../util/src/types.ts";

/** How a conversion words its failure, and the extended attributes it honours. */
export interface ConversionOptions {
  prefix?: string | undefined;
  context?: string | undefined;
  code?: string | undefined;
  enforceRange?: boolean | undefined;
  clamp?: boolean | undefined;
  allowShared?: boolean | undefined;
  allowResizable?: boolean | undefined;
}

export type Converter<T> = (value: unknown, options?: ConversionOptions) => T;

/** An IDL dictionary: a null-prototype object holding the members present. */
export type IdlDictionary = Record<string, unknown>;

const noOptions: ConversionOptions = {};

/**
 * Node's `codedTypeError`: a `TypeError` with `code` as an own property, and
 * none of the `ERR_*` classes' decoration -- its name and `toString` are the
 * built-in's.
 */
class CodedTypeError extends TypeError {
  override get ["constructor"](): unknown {
    return TypeError;
  }
  code: string;

  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

/** Node's `makeException`: "prefix: context message". */
export function makeException(message: string, options: ConversionOptions = noOptions): TypeError {
  const prefix = options.prefix ? `${options.prefix}: ` : "";
  const context = options.context?.length === 0 ? "" : `${options.context ?? "Value"} `;
  return new CodedTypeError(`${prefix}${context}${message}`, options.code || "ERR_INVALID_ARG_TYPE");
}

/** Node's `makeOptions`: the parent's options with a new context or code. */
export function makeOptions(
  options: ConversionOptions,
  context: string | undefined = options.context,
  code: string | undefined = options.code,
): ConversionOptions {
  return {
    prefix: options.prefix,
    context,
    code,
    enforceRange: options.enforceRange,
    clamp: options.clamp,
    allowShared: options.allowShared,
    allowResizable: options.allowResizable,
  };
}

export type LanguageType = "Undefined" | "Null" | "Boolean" | "String" | "Symbol" | "Number" | "BigInt" | "Object";

/** ECMA-262's type of a value, functions being Objects. */
export function type(value: unknown): LanguageType {
  switch (typeof value) {
    case "undefined":
      return "Undefined";
    case "boolean":
      return "Boolean";
    case "string":
      return "String";
    case "symbol":
      return "Symbol";
    case "number":
      return "Number";
    case "bigint":
      return "BigInt";
    default:
      return value === null ? "Null" : "Object";
  }
}

/** Web IDL's IntegerPart: truncation, and +0 for -0. */
function integerPart(n: number): number {
  const integer = Math.trunc(n);
  return integer === 0 ? 0 : integer;
}

/** ConvertToInt's rounding: to nearest, ties to even, +0 for -0. */
function evenRound(x: number): number {
  const i = integerPart(x);
  const remainder = Math.abs(x % 1);
  const sign = Math.sign(x);
  if (remainder === 0.5) return i % 2 === 0 ? i : i + sign;
  const r = remainder < 0.5 ? i : i + sign;
  return r === 0 ? 0 : r;
}

function pow2(exponent: number): number {
  if (exponent < 31) return 1 << exponent;
  if (exponent === 31) return 0x8000_0000;
  if (exponent === 32) return 0x1_0000_0000;
  return Math.pow(2, exponent);
}

/** Mathematical modulo by a positive power of two, as ConvertToInt step 10 uses it. */
function modulo(x: number, y: number): number {
  const r = x % y;
  if (r === 0) return 0;
  return r > 0 ? r : r + y;
}

const BIGINT_2_63 = 1n << 63n;
const BIGINT_2_64 = 1n << 64n;

/** ECMA-262's ToNumber, which refuses a BigInt and a Symbol in node's words. */
function toNumber(value: unknown, options: ConversionOptions = noOptions): number {
  if (typeof value === "bigint") throw makeException("is a BigInt and cannot be converted to a number.", options);
  if (typeof value === "symbol") throw makeException("is a Symbol and cannot be converted to a number.", options);
  // Unary plus is ToNumber, ToPrimitive included; `Number()` would accept a
  // BigInt that ToPrimitive produces.
  return +(value as number);
}

/** ECMA-262's ToString, which refuses a Symbol in node's words. */
function toString(value: unknown, options: ConversionOptions = noOptions): string {
  if (typeof value === "symbol") throw makeException("is a Symbol and cannot be converted to a string.", options);
  return String(value);
}

/** Web IDL's ConvertToInt. */
export function convertToInt(
  value: unknown,
  bitLength: number,
  signedness: "signed" | "unsigned" = "unsigned",
  options: ConversionOptions = noOptions,
): number {
  const signed = signedness === "signed";
  let upperBound: number;
  let lowerBound: number;
  if (bitLength === 64) {
    upperBound = Number.MAX_SAFE_INTEGER;
    lowerBound = signed ? Number.MIN_SAFE_INTEGER : 0;
  } else if (!signed) {
    lowerBound = 0;
    upperBound = pow2(bitLength) - 1;
  } else {
    lowerBound = -pow2(bitLength - 1);
    upperBound = pow2(bitLength - 1) - 1;
  }

  let x: number;
  if (typeof value === "number") {
    // An in-range Number converts to itself or its IntegerPart.
    if (value >= lowerBound && value <= upperBound) {
      const integer = Math.trunc(value);
      if (integer === value) return value === 0 ? 0 : value;
      if (options.clamp) return evenRound(value);
      return integer === 0 ? 0 : integer;
    }
    x = value;
  } else {
    x = toNumber(value, options);
  }
  if (x === 0) x = 0;

  if (options.enforceRange) {
    if (!Number.isFinite(x)) throw makeException("is not a finite number.", options);
    x = integerPart(x);
    if (x < lowerBound || x > upperBound) {
      throw makeException(
        `is outside the expected range of ${lowerBound} to ${upperBound}.`,
        makeOptions(options, options.context, "ERR_OUT_OF_RANGE"),
      );
    }
    return x;
  }

  if (options.clamp && !Number.isNaN(x)) {
    x = Math.min(Math.max(x, lowerBound), upperBound);
    return evenRound(x);
  }

  if (!Number.isFinite(x) || x === 0) return 0;
  x = integerPart(x);
  if (x >= lowerBound && x <= upperBound) return x;

  if (bitLength === 64) {
    let wide = BigInt(x) % BIGINT_2_64;
    if (wide < 0n) wide += BIGINT_2_64;
    if (signed && wide >= BIGINT_2_63) return Number(wide - BIGINT_2_64);
    return Number(wide);
  }
  if (bitLength === 8) return signed ? (x << 24) >> 24 : x & 0xff;
  if (bitLength === 16) return signed ? (x << 16) >> 16 : x & 0xffff;
  if (bitLength === 32) return signed ? x | 0 : x >>> 0;

  const twoToTheBitLength = pow2(bitLength);
  x = modulo(x, twoToTheBitLength);
  if (signed && x >= pow2(bitLength - 1)) return x - twoToTheBitLength;
  return x;
}

/** `requiredArguments`: fewer than `required` is `ERR_MISSING_ARGS`. */
export function requiredArguments(length: number, required: number, options: ConversionOptions = noOptions): void {
  if (length < required) {
    throw makeException(
      `${required} argument${required === 1 ? "" : "s"} required, but only ${length} present.`,
      makeOptions(options, "", "ERR_MISSING_ARGS"),
    );
  }
}

// -- the simple types -------------------------------------------------------------

export function convertBoolean(value: unknown): boolean {
  return !!value;
}

export function convertObject(value: unknown, options: ConversionOptions = noOptions): object {
  if (type(value) !== "Object") throw makeException("is not an object.", options);
  return value as object;
}

export function convertOctet(value: unknown, options: ConversionOptions = noOptions): number {
  return convertToInt(value, 8, "unsigned", options);
}

export function convertUnsignedShort(value: unknown, options: ConversionOptions = noOptions): number {
  return convertToInt(value, 16, "unsigned", options);
}

export function convertUnsignedLong(value: unknown, options: ConversionOptions = noOptions): number {
  return convertToInt(value, 32, "unsigned", options);
}

export function convertLongLong(value: unknown, options: ConversionOptions = noOptions): number {
  return convertToInt(value, 64, "signed", options);
}

export function convertDOMString(value: unknown, options: ConversionOptions = noOptions): string {
  return toString(value, options);
}

// -- enums, sequences and interfaces ---------------------------------------------------

/** A Web IDL enum: ToString, then membership. */
export function convertEnum(
  name: string,
  values: readonly string[],
  value: unknown,
  options: ConversionOptions = noOptions,
): string {
  const s = toString(value, options);
  if (!values.includes(s)) {
    throw makeException(
      `'${s}' is not a valid enum value of type ${name}.`,
      makeOptions(options, options.context, "ERR_INVALID_ARG_VALUE"),
    );
  }
  return s;
}

/** A Web IDL sequence, through the iteration protocol as the specification walks it. */
export function convertSequence<T>(value: unknown, options: ConversionOptions, element: Converter<T>): T[] {
  if (type(value) !== "Object") throw makeException("cannot be converted to sequence.", options);
  const method = (value as { [Symbol.iterator]?: unknown })[Symbol.iterator];
  if (typeof method !== "function") throw makeException("cannot be converted to sequence.", options);
  const iterator = (method as (this: unknown) => unknown).call(value) as { next?: unknown } | null | undefined;
  const next = iterator?.next;
  if (typeof next !== "function") throw makeException("cannot be converted to sequence.", options);
  const sequence: T[] = [];
  for (;;) {
    const step = (next as (this: unknown) => unknown).call(iterator) as { done?: unknown; value?: unknown };
    if (type(step) !== "Object") throw makeException("cannot be converted to sequence.", options);
    if (step.done) break;
    sequence.push(element(step.value, makeOptions(options, `${options.context ?? "Value"}[${sequence.length}]`)));
  }
  return sequence;
}

export function convertSequenceOfDOMString(value: unknown, options: ConversionOptions = noOptions): string[] {
  return convertSequence(value, options, convertDOMString);
}

export function convertSequenceOfObject(value: unknown, options: ConversionOptions = noOptions): object[] {
  return convertSequence(value, options, convertObject);
}

/** A Web IDL interface type, by its prototype, as node checks it. */
export function convertInterface<T>(name: string, prototype: object, value: unknown, options: ConversionOptions = noOptions): T {
  if (Object.prototype.isPrototypeOf.call(prototype, value as object)) return value as T;
  throw makeException(`is not of type ${name}.`, options);
}

// -- dictionaries -------------------------------------------------------------------------

/**
 * One dictionary's conversion, member by member: node's
 * `createDictionaryConverter` unrolled into a reader. Members are read in
 * code-unit order within each level of the dictionary's inheritance, least
 * derived first -- the order the specification reads them in, and so the
 * order a getter on the program's object runs in. The reader checks that
 * order rather than trusting the caller to have written it.
 */
export class DictionaryReader {
  readonly result: IdlDictionary;
  readonly #name: string;
  readonly #source: IdlDictionary | null;
  readonly #options: ConversionOptions;
  #lastKey = "";

  constructor(name: string, value: unknown, options: ConversionOptions = noOptions) {
    if (value != null && type(value) !== "Object") throw makeException("cannot be converted to a dictionary", options);
    this.#name = name;
    this.#source = value == null ? null : (value as IdlDictionary);
    this.#options = options;
    this.result = Object.create(null) as IdlDictionary;
  }

  /** The start of the next, more derived, level: its members are ordered afresh. */
  level(): this {
    this.#lastKey = "";
    return this;
  }

  /**
   * One member: converted and validated if present, and a failure if it is
   * required and absent. A validator is given the dictionary as the program
   * wrote it, for the members that depend on a sibling.
   */
  member(
    key: string,
    converter: Converter<unknown>,
    required = false,
    validator?: (value: unknown, dictionary: IdlDictionary) => void,
  ): this {
    if (key <= this.#lastKey) throw new Error(`${this.#name} reads '${key}' after '${this.#lastKey}'`);
    this.#lastKey = key;
    const value = this.#source == null ? undefined : this.#source[key];
    if (value !== undefined) {
      const options = this.#options;
      const idlValue = converter(value, makeOptions(options, options.context ? `${key} in ${options.context}` : key));
      if (validator !== undefined) validator(idlValue, this.#source!);
      this.result[key] = idlValue;
    } else if (required) {
      throw makeException(
        `cannot be converted to '${this.#name}' because '${key}' is required in '${this.#name}'.`,
        makeOptions(this.#options, this.#options.context, "ERR_MISSING_OPTION"),
      );
    }
    return this;
  }
}

// -- buffers ----------------------------------------------------------------------------

/**
 * `[[ArrayBufferResizable]]` of an ArrayBuffer, or null for anything that is
 * not one -- a SharedArrayBuffer included.
 */
function resizableOf(buffer: unknown): boolean | null {
  return isArrayBuffer(buffer) ? buffer.resizable : null;
}

function checkGrowable(buffer: SharedArrayBuffer, options: ConversionOptions): void {
  if (!options.allowResizable && buffer.growable) {
    throw makeException("is backed by a growable SharedArrayBuffer, which is not allowed.", options);
  }
}

function checkResizable(resizable: boolean, options: ConversionOptions): void {
  if (resizable && !options.allowResizable) {
    throw makeException("is backed by a resizable ArrayBuffer, which is not allowed.", options);
  }
}

/** A view's backing store under `[AllowShared]` and `[AllowResizable]`. */
function checkBacking(buffer: ArrayBufferLike, options: ConversionOptions): void {
  const resizable = resizableOf(buffer);
  if (resizable === null) {
    if (!options.allowShared) throw makeException("is a view on a SharedArrayBuffer, which is not allowed.", options);
    checkGrowable(buffer as SharedArrayBuffer, options);
    return;
  }
  checkResizable(resizable, options);
}

export function convertUint8Array(value: unknown, options: ConversionOptions = noOptions): Uint8Array {
  if (!isTypedArray(value) || !(value instanceof Uint8Array)) throw makeException("is not an Uint8Array object.", options);
  checkBacking(value.buffer, options);
  return value;
}

/** `BufferSource`: an ArrayBuffer or a view, never shared. */
export function convertBufferSource(value: unknown, options: ConversionOptions = noOptions): ArrayBuffer | ArrayBufferView {
  if (ArrayBuffer.isView(value)) {
    const resizable = resizableOf(value.buffer);
    if (resizable === null) throw makeException("is a view on a SharedArrayBuffer, which is not allowed.", options);
    checkResizable(resizable, options);
    return value;
  }
  const resizable = resizableOf(value);
  if (resizable === null) {
    throw makeException("is not instance of ArrayBuffer, Buffer, TypedArray, or DataView.", options);
  }
  checkResizable(resizable, options);
  return value as ArrayBuffer;
}

/** `AllowSharedBufferSource`: a buffer of either kind, or a view on one. */
export function convertAllowSharedBufferSource(
  value: unknown,
  options: ConversionOptions = noOptions,
): ArrayBuffer | SharedArrayBuffer | ArrayBufferView {
  if (ArrayBuffer.isView(value)) {
    const buffer = value.buffer;
    const resizable = resizableOf(buffer);
    if (resizable === null) checkGrowable(buffer as SharedArrayBuffer, options);
    else checkResizable(resizable, options);
    return value;
  }
  const resizable = resizableOf(value);
  if (resizable === null) {
    if (isSharedArrayBuffer(value)) {
      checkGrowable(value, options);
      return value;
    }
    throw makeException(
      "is not instance of ArrayBuffer, SharedArrayBuffer, Buffer, TypedArray, or DataView.",
      options,
    );
  }
  checkResizable(resizable, options);
  return value as ArrayBuffer;
}

/** Node's converter table, by IDL type name: made on request, for the tests that read it. */
export function converters(): Record<string, Converter<unknown>> {
  return {
    boolean: convertBoolean,
    object: convertObject,
    octet: convertOctet,
    "unsigned short": convertUnsignedShort,
    "unsigned long": convertUnsignedLong,
    "long long": convertLongLong,
    DOMString: convertDOMString,
    Uint8Array: convertUint8Array,
    BufferSource: convertBufferSource,
    AllowSharedBufferSource: convertAllowSharedBufferSource,
    "sequence<DOMString>": convertSequenceOfDOMString,
    "sequence<object>": convertSequenceOfObject,
  };
}
