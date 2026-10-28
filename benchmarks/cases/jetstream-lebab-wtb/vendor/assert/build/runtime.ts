// Concrete value boundaries for the pinned browser assertion implementation.
import {isRecord, readProperty, record, runtimeCallable} from "../../../webpack.ts";
import type {RuntimeCallable} from "../../../webpack.ts";

export interface AssertionOptions {
  actual?: unknown;
  expected?: unknown;
  message?: unknown;
  operator?: unknown;
  stackStartFn?: unknown;
}
export interface AssertionInstance extends Error {
  actual: unknown;
  expected: unknown;
  operator: unknown;
  generatedMessage: boolean;
  code: string;
}
export interface AssertionConstructor {
  new (options?: unknown): AssertionInstance;
}
export type AssertionCall = (...args: unknown[]) => void;
export interface AssertAPI extends AssertionCall {
  fail: (...args: unknown[]) => never;
  AssertionError: AssertionConstructor;
  ok: AssertionCall;
  equal: AssertionCall;
  notEqual: AssertionCall;
  deepEqual: AssertionCall;
  notDeepEqual: AssertionCall;
  deepStrictEqual: AssertionCall;
  notDeepStrictEqual: AssertionCall;
  strictEqual: AssertionCall;
  notStrictEqual: AssertionCall;
  throws: AssertionCall;
  rejects: (...args: unknown[]) => Promise<void>;
  doesNotThrow: AssertionCall;
  doesNotReject: (...args: unknown[]) => Promise<void>;
  ifError: AssertionCall;
  match: AssertionCall;
  doesNotMatch: AssertionCall;
  strict: AssertAPI;
}
export interface InitializingAssert extends AssertionCall, Partial<Omit<AssertAPI, "strict">> {strict?: InitializingAssert;}
function isInitializingAssert(value: unknown): value is InitializingAssert {
  return typeof value === "function" && ["fail", "AssertionError", "ok", "equal", "notEqual", "deepEqual", "notDeepEqual", "deepStrictEqual", "notDeepStrictEqual", "strictEqual", "notStrictEqual", "throws", "rejects", "doesNotThrow", "doesNotReject", "ifError", "match", "doesNotMatch", "strict"].every(key => {const member = readProperty(value, key);return member === undefined || typeof member === "function";});
}
export function initializingAssert(value: unknown): InitializingAssert {
  if (!isInitializingAssert(value)) throw new TypeError("Unexpected assertion initialization object");
  return value;
}
export function isAssertAPI(value: unknown): value is AssertAPI {
  return typeof value === "function" && ["fail", "AssertionError", "ok", "equal", "notEqual", "deepEqual", "notDeepEqual", "deepStrictEqual", "notDeepStrictEqual", "strictEqual", "notStrictEqual", "throws", "rejects", "doesNotThrow", "doesNotReject", "ifError", "match", "doesNotMatch", "strict"].every(key => typeof readProperty(value, key) === "function");
}
export function readyAssert(value: unknown): AssertAPI {
  if (!isAssertAPI(value)) throw new TypeError("Incomplete assertion module");
  return value;
}
export function propertyObject(value: unknown): Record<PropertyKey, unknown> {
  if (value === null || value === undefined) throw new TypeError("Cannot convert undefined or null to object");
  const boxed: unknown = Object(value);
  return record(boxed);
}
export function stringValue(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("Expected an assertion string");
  return value;
}
export function numericValue(value: unknown): number {
  if (typeof value !== "number") throw new TypeError("Expected an assertion number");
  return value;
}
// String.prototype.concat performs the original ToString, including rejecting symbols.
export function concatValue(value: unknown): string {
  return stringValue(runtimeCallable(String.prototype.concat).call("", value));
}
export type DeepComparison = (a: unknown, b: unknown) => boolean;
export interface ComparisonExports {isDeepEqual: DeepComparison;isDeepStrictEqual: DeepComparison;}
export function unknownArray(value: unknown[]): unknown[] { return value; }
export function assertionMethod(receiver: unknown, key: PropertyKey, args: unknown[], expression: string): unknown {
  const method = readProperty(receiver, key);
  if (typeof method !== "function") throw new TypeError(expression + " is not a function");
  const result: unknown = method.apply(receiver, args);
  return result;
}
export interface ComparisonMemos {val1: Map<unknown, number>; val2: Map<unknown, number>; position: number;}
interface NativeBytes { new (value: unknown, offset?: unknown, length?: unknown): Uint8Array; }
function isNativeBytes(value: unknown): value is NativeBytes { return value === Uint8Array; }
export function nativeBytes(value: unknown): NativeBytes {
  if (!isNativeBytes(value)) throw new TypeError("Expected the Uint8Array intrinsic");
  return value;
}
export interface ErrorCodeInstance extends Error {code: string;}
export type ErrorCodeConstructor = new (arg1?: unknown, arg2?: unknown, arg3?: unknown) => ErrorCodeInstance;
export type ErrorCode = "ERR_AMBIGUOUS_ARGUMENT" | "ERR_INVALID_ARG_TYPE" | "ERR_INVALID_ARG_VALUE" | "ERR_INVALID_RETURN_VALUE" | "ERR_MISSING_ARGS";
export type ErrorCodes = Record<ErrorCode, ErrorCodeConstructor>;
export function isErrorCodes(value: unknown): value is ErrorCodes {
  return isRecord(value) && ["ERR_AMBIGUOUS_ARGUMENT", "ERR_INVALID_ARG_TYPE", "ERR_INVALID_ARG_VALUE", "ERR_INVALID_RETURN_VALUE", "ERR_MISSING_ARGS"].every(key => typeof value[key] === "function");
}
export interface HelperConstructor {
  new (...args: unknown[]): object;
  prototype: object;
  apply(receiver: unknown, args: ArrayLike<unknown>): unknown;
}
function isHelperConstructor(value: unknown): value is HelperConstructor {
  return typeof value === "function" && isRecord(readProperty(value, "prototype"));
}
export function helperConstructor(value: unknown): HelperConstructor {
  if (!isHelperConstructor(value)) throw new TypeError("Expected an error constructor");
  return value;
}
export type ConstructRoutine = (parent: unknown, args: ArrayLike<unknown>, target?: unknown) => object;
function isConstructRoutine(value: unknown): value is ConstructRoutine { return typeof value === "function"; }
export function constructRoutine(value: unknown): ConstructRoutine {
  if (!isConstructRoutine(value)) throw new TypeError("Expected the native construction helper");
  return value;
}
export interface ErrorConstruction extends Error, Record<PropertyKey, unknown> {
  code?: string;
  generatedMessage?: boolean;
  actual?: unknown;
  expected?: unknown;
  operator?: unknown;
}
function isErrorConstruction(value: unknown): value is ErrorConstruction {
  return isRecord(value) && typeof value.name === "string" && typeof value.message === "string";
}
export function errorConstruction(value: unknown): ErrorConstruction {
  if (!isErrorConstruction(value)) throw new TypeError("Expected the constructed error object");
  return value;
}
function isErrorCodeInstance(value: unknown): value is ErrorCodeInstance {
  return isErrorConstruction(value) && typeof value.code === "string";
}
export function errorCodeInstance(value: unknown): ErrorCodeInstance {
  if (!isErrorCodeInstance(value)) throw new TypeError("Expected a constructed NodeError");
  return value;
}
function isAssertionInstance(value: unknown): value is AssertionInstance {
  return isErrorConstruction(value) && typeof value.code === "string" && typeof value.generatedMessage === "boolean" && "actual" in value && "expected" in value && "operator" in value;
}
export function assertionInstance(value: unknown): AssertionInstance {
  if (!isAssertionInstance(value)) throw new TypeError("Expected a constructed AssertionError");
  return value;
}
export type ErrorMessage = string | RuntimeCallable;
export interface AssertStderr {isTTY?: boolean;columns?: number;getColorDepth?: () => number;}
export function stderrValue(value: unknown): AssertStderr | undefined {
  if (!value) return undefined;
  if (!isRecord(value)) throw new TypeError("Expected a stderr object");
  if (!isStderr(value)) throw new TypeError("Unexpected stderr layout");
  return value;
}
function isStderr(value: Record<PropertyKey, unknown>): value is Record<PropertyKey, unknown> & AssertStderr {
  return (value.isTTY === undefined || typeof value.isTTY === "boolean") && (value.columns === undefined || typeof value.columns === "number") && (value.getColorDepth === undefined || typeof value.getColorDepth === "function");
}
