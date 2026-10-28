// Checked views for the pinned Lodash implementation. Values retain their identity.
import {isRecord, record} from "../../webpack.ts";

export type LodashFunction = (this: never, ...args: never[]) => unknown;
export interface LodashDynamicFunction { (this: unknown, ...args: unknown[]): unknown; placeholder?: unknown; }
export interface LodashMemoizedFunction extends LodashDynamicFunction { cache?: LodashCache; }
export type LodashWrapData = [LodashFunction | string | undefined, number, unknown, unknown[] | undefined, number[] | undefined, unknown[] | undefined, number[] | undefined, unknown[] | undefined, number | undefined, number | undefined];
export interface LodashCallable {
    (this: unknown, ...args: unknown[]): unknown;
    apply(receiver: unknown, args?: ArrayLike<unknown> | null): unknown;
    call(receiver: unknown, ...args: unknown[]): unknown;
    bind(receiver: unknown, ...args: unknown[]): LodashCallable;
    readonly length: number;
    readonly name: string;
    prototype: unknown;
    [key: PropertyKey]: unknown;
}
function isCallableValue(value: unknown): value is LodashCallable { return typeof value === "function"; }
export function callableValue(value: unknown): LodashCallable {
    if (!isCallableValue(value)) throw new TypeError("Expected the original Lodash callable");
    return value;
}
function isDynamicFunction(value: unknown): value is LodashDynamicFunction { return typeof value === "function"; }
export function dynamicFunction(value: unknown): LodashDynamicFunction {
    if (!isDynamicFunction(value)) throw new TypeError("Expected a Lodash wrapper function");
    return value;
}
export function arrayValue(value: unknown): unknown[] {
    if (!Array.isArray(value)) throw new TypeError("Expected a Lodash array");
    return value;
}
export function isArrayValue(value: unknown): value is unknown[] { return Array.isArray(value); }
export function stringValue(value: unknown): string {
    if (typeof value !== "string") throw new TypeError("Expected a Lodash string");
    return value;
}
export function numberValue(value: unknown): number {
    if (typeof value !== "number") throw new TypeError("Expected a Lodash number");
    return value;
}
export function booleanValue(value: unknown): boolean {
    if (typeof value !== "boolean") throw new TypeError("Expected a Lodash boolean");
    return value;
}
export function stringArray(value: unknown): string[] {
    if (!isStringArray(value)) throw new TypeError("Expected Lodash string metadata");
    return value;
}
function isNumberArray(value: unknown): value is number[] { return isArrayValue(value) && value.every(item => typeof item === "number"); }
export function numberArray(value: unknown): number[] {
    if (!isNumberArray(value)) throw new TypeError("Expected Lodash index metadata");
    return value;
}
function isStringArray(value: unknown): value is string[] { return isArrayValue(value) && value.every(item => typeof item === "string"); }
function isSymbolArray(value: unknown): value is symbol[] { return isArrayValue(value) && value.every(item => typeof item === "symbol"); }
export function symbolArray(value: unknown): symbol[] {
    if (!isSymbolArray(value)) throw new TypeError("Expected Lodash symbol keys");
    return value;
}
export function matchData(value: unknown): [string, unknown, boolean][] {
    if (!isMatchData(value)) throw new TypeError("Expected Lodash match metadata");
    return value;
}
function isMatchData(value: unknown): value is [string, unknown, boolean][] {
    return isArrayValue(value) && value.every(item => isArrayValue(item) && item.length === 3 && typeof item[0] === "string" && typeof item[2] === "boolean");
}
export type LodashTypedArray = Float32Array<ArrayBufferLike> | Float64Array<ArrayBufferLike> | Int8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Uint8ClampedArray<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>;
type Primitive = string | number | boolean | bigint | symbol | null | undefined;
function isPrimitive(value: unknown): value is Primitive { return value === null || (typeof value !== "object" && typeof value !== "function"); }
// These views perform the same primitive conversion as the operator at the
// original call site. They retain the hook receiver, hint and evaluation order.
function primitiveValue(value: unknown, hint: "default" | "number" | "string"): Primitive {
    if (isPrimitive(value)) return value;
    const object = record(value);
    const exotic = object[Symbol.toPrimitive];
    if (exotic !== undefined && exotic !== null) {
        const result = callableValue(exotic).call(value, hint);
        if (isPrimitive(result)) return result;
        throw new TypeError("Cannot convert object to primitive value");
    }
    const methods = hint === "string" ? ["toString", "valueOf"] : ["valueOf", "toString"];
    for (const name of methods) {
        const method = object[name];
        if (typeof method === "function") {
            const result = callableValue(method).call(value);
            if (isPrimitive(result)) return result;
        }
    }
    throw new TypeError("Cannot convert object to primitive value");
}
export function propertyKey(value: unknown): string | symbol {
    const primitive = primitiveValue(value, "string");
    return typeof primitive === "symbol" ? primitive : String(primitive);
}
export function writeProperty(value: unknown, key: PropertyKey, item: unknown): unknown {
    record(value)[key] = item;
    return item;
}
export function numericValue(value: unknown): number {
    const primitive = primitiveValue(value, "number");
    if (typeof primitive === "bigint" || typeof primitive === "symbol") throw new TypeError("Cannot convert value to a number");
    return Number(primitive);
}
export function concatenatedString(value: unknown): string {
    const primitive = primitiveValue(value, "default");
    if (typeof primitive === "symbol") throw new TypeError("Cannot convert a Symbol value to a string");
    return String(primitive);
}
export function addedValues(left: unknown, right: unknown): unknown {
    const first = primitiveValue(left, "default");
    const second = primitiveValue(right, "default");
    if (typeof first === "string" || typeof second === "string") {
        if (typeof first === "symbol" || typeof second === "symbol") throw new TypeError("Cannot convert a Symbol value to a string");
        return String(first) + String(second);
    }
    if (typeof first === "bigint" && typeof second === "bigint") return first + second;
    if (typeof first === "bigint" || typeof second === "bigint" || typeof first === "symbol" || typeof second === "symbol") throw new TypeError("Cannot mix numeric value kinds");
    return Number(first) + Number(second);
}
export function coercedString(value: unknown): string {
    const primitive = primitiveValue(value, "string");
    if (typeof primitive === "symbol") throw new TypeError("Cannot convert a Symbol value to a string");
    return String(primitive);
}
export function relationalValue(value: unknown): string | number | bigint {
    const primitive = primitiveValue(value, "number");
    if (typeof primitive === "string" || typeof primitive === "number" || typeof primitive === "bigint") return primitive;
    if (typeof primitive === "symbol") throw new TypeError("Cannot convert a Symbol value to a number");
    return Number(primitive);
}
export function numericRelationalValue(value: unknown): number | bigint {
    const primitive = relationalValue(value);
    return typeof primitive === "string" ? Number(primitive) : primitive;
}
export interface LodashBuffer extends Omit<Uint8Array<ArrayBufferLike>, "slice"> {
    copy(target: LodashBuffer): number;
    slice(start?: number, end?: number): LodashBuffer;
}
function isBufferValue(value: unknown): value is LodashBuffer {
    return isRecord(value) && ArrayBuffer.isView(value) && typeof value.copy === "function" && typeof value.slice === "function";
}
export function bufferValue(value: unknown): LodashBuffer {
    if (!isBufferValue(value)) throw new TypeError("Expected a Lodash Buffer value");
    return value;
}
function isArrayBufferValue(value: unknown): value is ArrayBufferLike {
    return isRecord(value) && typeof value.byteLength === "number" && (Object.prototype.toString.call(value) === "[object ArrayBuffer]" || Object.prototype.toString.call(value) === "[object SharedArrayBuffer]");
}
export function arrayBufferValue(value: unknown): ArrayBufferLike {
    if (!isArrayBufferValue(value)) throw new TypeError("Expected a Lodash array buffer");
    return value;
}
function isDataViewValue(value: unknown): value is DataView {
    return isRecord(value) && ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === "[object DataView]";
}
export function dataViewValue(value: unknown): DataView {
    if (!isDataViewValue(value)) throw new TypeError("Expected a Lodash DataView");
    return value;
}
function isTypedArrayValue(value: unknown): value is LodashTypedArray {
    return isRecord(value) && ArrayBuffer.isView(value) && typeof value.BYTES_PER_ELEMENT === "number" && typeof value.length === "number";
}
export function typedArrayValue(value: unknown): LodashTypedArray {
    if (!isTypedArrayValue(value)) throw new TypeError("Expected a Lodash typed array");
    return value;
}
function isRegExpValue(value: unknown): value is RegExp { return isRecord(value) && typeof value.exec === "function" && typeof value.source === "string" && typeof value.lastIndex === "number"; }
export function regExpValue(value: unknown): RegExp {
    if (!isRegExpValue(value)) throw new TypeError("Expected a Lodash RegExp");
    return value;
}
function isMapValue(value: unknown): value is Map<unknown, unknown> {
    return isRecord(value) && typeof value.size === "number" && typeof value.get === "function" && typeof value.set === "function" && typeof value.forEach === "function" && typeof value[Symbol.iterator] === "function";
}
export function mapValue(value: unknown): Map<unknown, unknown> {
    if (!isMapValue(value)) throw new TypeError("Expected a Lodash Map");
    return value;
}
function isSetValue(value: unknown): value is Set<unknown> {
    return isRecord(value) && typeof value.size === "number" && typeof value.add === "function" && typeof value.forEach === "function" && typeof value[Symbol.iterator] === "function";
}
export function setValue(value: unknown): Set<unknown> {
    if (!isSetValue(value)) throw new TypeError("Expected a Lodash Set");
    return value;
}
export interface LodashBufferConstructor {
    new (size: number): LodashBuffer;
    allocUnsafe?(size: number): LodashBuffer;
    isBuffer(value: unknown): value is LodashBuffer;
}
export interface LodashArrayConstructor {
    <T = unknown>(length?: number): T[];
    new <T = unknown>(length?: number): T[];
    prototype: unknown[];
    isArray(value: unknown): value is unknown[];
}
export interface LodashFunctionConstructor {
    (...parameters: unknown[]): LodashCallable;
    new (...parameters: unknown[]): LodashCallable;
    prototype: Object;
}
export interface LodashErrorConstructor {
    (message?: unknown): Error;
    new (message?: unknown): Error;
    prototype: Error;
}
export interface LodashTemplateOptions {
    escape?: {source: string} | false | null;
    evaluate?: {source: string} | false | null;
    interpolate?: {source: string} | false | null;
    imports?: Record<PropertyKey, unknown>;
    variable?: unknown;
    sourceURL?: unknown;
}
function isTemplateOptions(value: unknown): value is LodashTemplateOptions {
    if (!isRecord(value)) return false;
    for (const key of ["escape", "evaluate", "interpolate"]) {
        const expression = value[key];
        if (expression && (!isRecord(expression) || typeof expression.source !== "string")) return false;
    }
    return value.imports === undefined || isRecord(value.imports);
}
export function templateOptions(value: unknown): LodashTemplateOptions {
    if (!isTemplateOptions(value)) throw new TypeError("Expected Lodash template options");
    return value;
}
export interface LodashObjectConstructor {
    (value?: unknown): Record<PropertyKey, unknown>;
    prototype: Object;
    keys(value: object): string[];
    getPrototypeOf(value: object): object | null;
    create?: (prototype: object | null) => Record<PropertyKey, unknown>;
    defineProperty?: (value: object, key: PropertyKey, descriptor: PropertyDescriptor) => object;
    getOwnPropertySymbols?: (value: object) => symbol[];
}
export interface LodashContext {
    Array: LodashArrayConstructor;
    Buffer?: LodashBufferConstructor | null;
    Date: DateConstructor;
    Error: LodashErrorConstructor;
    Function: LodashFunctionConstructor;
    Math: Math;
    Object: LodashObjectConstructor;
    RegExp: RegExpConstructor;
    String: StringConstructor;
    TypeError: LodashErrorConstructor;
    Symbol?: SymbolConstructor | null;
    Uint8Array: Uint8ArrayConstructor;
    DataView?: DataViewConstructor | null;
    Map?: MapConstructor | null;
    Promise?: PromiseConstructor | null;
    Set?: SetConstructor | null;
    WeakMap?: WeakMapConstructor | null;
    "__core-js_shared__"?: {keys?: {IE_PROTO?: string}};
    isFinite(value: number): boolean;
    parseInt(value: string, radix?: number): number;
    clearTimeout(handle: unknown): void;
    setTimeout(callback: LodashFunction, delay?: number): unknown;
}
function callable(value: unknown): boolean { return typeof value === "function"; }
function isLodashContext(value: unknown): value is LodashContext {
    if (!isRecord(value)) return false;
    if (!isRecord(value.Array) || !callable(value.Array) || !callable(value.Array.isArray)) return false;
    if (!isRecord(value.Date) || !callable(value.Date) || !callable(value.Date.now)) return false;
    if (!callable(value.Error) || !callable(value.Function) || !callable(value.RegExp) || !callable(value.String) || !callable(value.TypeError)) return false;
    if (!isRecord(value.Math) || !["ceil", "floor", "max", "min", "random"].every(key => callable(record(value.Math)[key]))) return false;
    if (!isRecord(value.Object) || !callable(value.Object) || !callable(value.Object.keys) || !callable(value.Object.getPrototypeOf)) return false;
    if (!callable(value.Uint8Array) || !callable(value.isFinite) || !callable(value.parseInt) || !callable(value.clearTimeout) || !callable(value.setTimeout)) return false;
    for (const key of ["Buffer", "Symbol", "DataView", "Map", "Promise", "Set", "WeakMap"]) {
        if (value[key] !== null && value[key] !== undefined && !callable(value[key])) return false;
    }
    return true;
}
export function contextValue(value: unknown): LodashContext {
    if (!isLodashContext(value)) throw new TypeError("Expected the complete Lodash intrinsic context");
    return value;
}
export function assertContext(value: unknown): asserts value is LodashContext {
    if (!isLodashContext(value)) throw new TypeError("Expected the complete Lodash intrinsic context");
}
export interface LodashAction { func: LodashFunction; args: ArrayLike<unknown>; thisArg: unknown; }
export type LodashEachIteratee = (value: unknown, key: string | number, collection: unknown) => unknown;
export type LodashEach = (collection: unknown, iteratee: LodashEachIteratee) => unknown;
export type LodashFor = (object: unknown, iteratee: LodashEachIteratee, keys: (value: unknown) => string[]) => unknown;
export interface LodashCriterion { criteria: unknown[]; index: number; value: unknown; }
function isCriterionValue(value: unknown): value is LodashCriterion { return isRecord(value) && isArrayValue(value.criteria) && typeof value.index === "number"; }
export function criterionValue(value: unknown): LodashCriterion {
    if (!isCriterionValue(value)) throw new TypeError("Expected Lodash sort criteria");
    return value;
}
export function actionArray(value: unknown): LodashAction[] {
    if (!isActionArray(value)) throw new TypeError("Expected Lodash wrapper actions");
    return value;
}
function isActionArray(value: unknown): value is LodashAction[] {
    return isArrayValue(value) && value.every(item => isRecord(item) && typeof item.func === "function" && isRecord(item.args) && typeof item.args.length === "number");
}
export interface LodashIteratee { iteratee: LodashFunction; type: number; }
export interface LodashView { size: number; type: string; }
export interface LodashCache {
    size: number;
    clear(): void;
    delete(key: unknown): boolean;
    get(key: unknown): unknown;
    has(key: unknown): boolean;
    set(key: unknown, value: unknown): LodashCache;
}
export function present<T>(value: T | undefined | null): T {
    if (value === undefined || value === null) throw new TypeError("Expected a Lodash phase value");
    return value;
}

export function hashKey(value: unknown): PropertyKey {
    if (typeof value === "string" || typeof value === "number" || typeof value === "symbol") return value;
    if (value === null || value === undefined || typeof value === "boolean") return String(value);
    throw new TypeError("Expected a primitive Lodash hash key");
}

// A native class has a nonwritable .prototype. Keep the original prototype
// allocation and install its complete chain and own descriptors on that object.
export function installClassPrototype(target: { readonly prototype: object }, source: object): object {
    const prototype = target.prototype;
    const parent: unknown = Object.getPrototypeOf(source);
    if (parent !== null && !isRecord(parent)) throw new TypeError("Expected a prototype object");
    for (const key of Reflect.ownKeys(prototype)) delete record(prototype)[key];
    Object.setPrototypeOf(prototype, parent);
    for (const key of Reflect.ownKeys(source)) {
        const descriptor = Object.getOwnPropertyDescriptor(source, key);
        Object.defineProperty(prototype, key, present(descriptor));
    }
    return prototype;
}

interface MutablePrototypeAllocator { new (): object; prototype: object | undefined; }
function isMutablePrototypeAllocator(value: unknown): value is MutablePrototypeAllocator {
    if (typeof value !== "function") return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, "prototype");
    return descriptor !== undefined && descriptor.writable === true &&
        (descriptor.value === undefined || isRecord(descriptor.value));
}
export function mutablePrototypeAllocator(value: unknown): MutablePrototypeAllocator {
    if (!isMutablePrototypeAllocator(value)) throw new TypeError("Expected the original mutable-prototype allocator");
    return value;
}
