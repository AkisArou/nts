// The pinned Webpack wrapper operations, shared by the statically named modules.
export interface ModuleRecord { exports: unknown; paths?: string[]; children?: ModuleRecord[]; loaded?: boolean; }
export function isRecord(value: unknown): value is Record<PropertyKey, unknown> { return value !== null && (typeof value === "object" || typeof value === "function"); }
export function record(value: unknown): Record<PropertyKey, unknown> { if (!isRecord(value)) throw new TypeError("Expected a module object"); return value; }
export const webpack = {
 g: globalThis,
 o: (object: object, property: PropertyKey) => Object.prototype.hasOwnProperty.call(object, property),
 d(exports: object, definition: Record<string, () => unknown>) { for (var key in definition) { if (webpack.o(definition, key) && !webpack.o(exports, key)) { Object.defineProperty(exports, key, { enumerable: true, get: definition[key] }); } } },
 r(exports: object) { if (typeof Symbol !== 'undefined' && Symbol.toStringTag) { Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' }); } Object.defineProperty(exports, '__esModule', { value: true }); },
 nmd<T extends ModuleRecord>(module: T): T { module.paths = []; if (!module.children) module.children = []; return module; }
};

export function readProperty(value: unknown, key: PropertyKey): unknown {
  if (value === null || value === undefined) throw new TypeError("Cannot read a nullish value");
  const boxed: unknown = Object(value);
  return record(boxed)[key];
}

export interface Constructor { new (...args: never[]): object; prototype: object; }
export interface Descriptor { key: unknown; value?: unknown; get?: () => unknown; set?: (value: unknown) => void; enumerable?: boolean; configurable?: boolean; writable?: boolean; }
export function symbolValue(value: unknown): symbol { if (typeof value !== "symbol") throw new TypeError("Expected symbol property key"); return value; }
export function isPrimitiveMethod(value: unknown): value is (this: unknown, hint: string) => unknown { return typeof value === "function"; }
export function primitiveMethod(value: unknown): ((this: unknown, hint: string) => unknown) | undefined { if (value === undefined) return value; if (!isPrimitiveMethod(value)) throw new TypeError("Expected @@toPrimitive method"); return value; }
export function hasEsModuleFlag<T extends object>(value: T): value is T & {__esModule: true} { return "__esModule" in value && value.__esModule === true; }
export function exportsReady<T extends object, K extends keyof T>(value: T, keys: readonly K[]): value is T & Required<Pick<T, K>> {
  return keys.every(key => value[key] !== undefined);
}

// Checked runtime boundaries shared with the sibling Babel transcription.
export type RuntimeRecord = Record<PropertyKey, unknown>;
export type RuntimeCallable = (this: unknown, ...args: unknown[]) => unknown;
export type RuntimeConstructor = new (...args: unknown[]) => object;
export type IteratorMethod = (value?: unknown) => IteratorResult<unknown, unknown>;
export interface RuntimeIterator {
  next: IteratorMethod;
  return?: IteratorMethod;
  throw?: IteratorMethod;
}
export function isRuntimeRecord(value: unknown): value is RuntimeRecord {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}
export function runtimeRecord(value: unknown): RuntimeRecord {
  if (!isRuntimeRecord(value)) throw new TypeError("Expected an object");
  return value;
}
export function runtimeProperty(value: unknown, key: PropertyKey): unknown {
  if (isRuntimeRecord(value)) return value[key];
  if (value === null || value === undefined) throw new TypeError("Cannot read properties of " + value);
  const boxed: unknown = Object(value);
  return runtimeRecord(boxed)[key];
}
export function runtimeCall(fn: unknown, receiver: unknown, args: ArrayLike<unknown>): unknown {
  if (typeof fn !== "function") throw new TypeError("Expected a callable value");
  const result: unknown = fn.apply(receiver, args);
  return result;
}
export function runtimeMethod(receiver: unknown, key: PropertyKey, args: ArrayLike<unknown>): unknown {
  return runtimeCall(runtimeProperty(receiver, key), receiver, args);
}
export function runtimeArrayLike(value: unknown): ArrayLike<unknown> {
  if (typeof value === "string") return value;
  if (!isRuntimeArrayLike(value)) throw new TypeError("Expected an array-like value");
  return value;
}
export function isRuntimeArrayLike(value: unknown): value is ArrayLike<unknown> {
  return isRuntimeRecord(value) && typeof value.length === "number";
}
export function isRuntimeIterable(value: unknown): value is Iterable<unknown, unknown, unknown> {
  return value != null && typeof runtimeProperty(value, Symbol.iterator) === "function";
}
export function runtimeArrayLikeOrIterable(value: unknown): ArrayLike<unknown> | Iterable<unknown, unknown, unknown> {
  if (isRuntimeIterable(value)) return value;
  return runtimeArrayLike(value);
}
export function isRuntimeCallable(value: unknown): value is RuntimeCallable {
  return typeof value === "function";
}
export function runtimeCallable(value: unknown): RuntimeCallable {
  if (!isRuntimeCallable(value)) throw new TypeError("Expected a callable value");
  return value;
}
export function runtimeConstructor(value: unknown): RuntimeConstructor {
  if (!isRuntimeConstructor(value)) throw new TypeError("Expected a constructor");
  return value;
}
export function isRuntimeConstructor(value: unknown): value is RuntimeConstructor {
  return typeof value === "function";
}
export function isRuntimeIterator(value: unknown): value is RuntimeIterator {
  return isRuntimeRecord(value) && typeof value.next === "function";
}
export function runtimeIterator(value: unknown): RuntimeIterator {
  if (!isRuntimeIterator(value)) throw new TypeError("Expected an iterator");
  return value;
}
export interface RawIteratorResult {done?: unknown; value?: unknown;}
export function runtimeIteratorResult(value: unknown): RawIteratorResult {
  if (!isRuntimeIteratorResult(value)) throw new TypeError("iterator result is not an object");
  return value;
}
export function isRuntimeIteratorResult(value: unknown): value is RawIteratorResult {
  return isRuntimeRecord(value);
}
export function isBoundSetPrototypeOf(value: unknown): value is (object: object, prototype: object | null) => object {
  return typeof value === "function";
}
export function boundSetPrototypeOf(value: unknown): (object: object, prototype: object | null) => object {
  if (!isBoundSetPrototypeOf(value)) throw new TypeError("Expected the bound setPrototypeOf intrinsic");
  return value;
}
