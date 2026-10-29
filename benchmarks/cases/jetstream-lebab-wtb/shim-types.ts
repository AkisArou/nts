// Concrete boundaries for the bundled browser compatibility modules.
import {isRecord} from "./webpack.ts";
export interface BrowserProcess extends Record<PropertyKey, unknown> {
    title: string;
    browser: boolean;
    env: Record<string, string | undefined>;
    argv: unknown[];
    version: string;
    versions: Record<string, string | undefined>;
    nextTick(callback: unknown, ...args: unknown[]): void;
    on(...args: unknown[]): void;
    addListener(...args: unknown[]): void;
    once(...args: unknown[]): void;
    off(...args: unknown[]): void;
    removeListener(...args: unknown[]): void;
    removeAllListeners(...args: unknown[]): void;
    emit(...args: unknown[]): void;
    prependListener(...args: unknown[]): void;
    prependOnceListener(...args: unknown[]): void;
    listeners(name: unknown): unknown[];
    binding(name: unknown): never;
    cwd(): string;
    chdir(directory: unknown): never;
    umask(): number;
    pid?: number;
    noDeprecation?: boolean;
    throwDeprecation?: boolean;
    traceDeprecation?: boolean;
    stderr?: { isTTY?: boolean; columns?: number; getColorDepth?: () => number };
    emitWarning?: (...args: unknown[]) => void;
}
function stringDictionary(value: unknown): value is Record<string, string | undefined> {
    if (!isRecord(value)) return false;
    for (const key in value) {
        if (Object.prototype.hasOwnProperty.call(value, key) && value[key] !== undefined && typeof value[key] !== "string") return false;
    }
    return true;
}
export function isBrowserProcess(value: unknown): value is BrowserProcess {
    return isRecord(value) && typeof value.title === "string" && typeof value.browser === "boolean" &&
        stringDictionary(value.env) && Array.isArray(value.argv) && typeof value.version === "string" && stringDictionary(value.versions) &&
        ["nextTick", "on", "addListener", "once", "off", "removeListener", "removeAllListeners", "emit", "prependListener", "prependOnceListener", "listeners", "binding", "cwd", "chdir", "umask"].every(key => typeof value[key] === "function");
}

export interface ShimDescriptor {
    configurable?: boolean;
    enumerable?: boolean;
    value?: unknown;
    writable?: boolean;
    get?: () => unknown;
    set?: (value: unknown) => void;
}
export type ShimGetDescriptor = (value: unknown, key: PropertyKey) => ShimDescriptor | undefined;
export type ShimDefineProperty = <T extends object>(value: T, key: PropertyKey, descriptor: ShimDescriptor) => T;
export type ShimGetPrototype = (value: unknown) => object | null;
export type ShimApply = (target: unknown, receiver: unknown, args: ArrayLike<unknown>) => unknown;
export type ShimFunctionCall = (this: unknown, receiver: unknown, ...args: unknown[]) => unknown;
export type ShimFunctionApply = (this: unknown, receiver: unknown, args?: ArrayLike<unknown> | null) => unknown;

import type {LodashCallable} from "./vendor/lodash/runtime.ts";
export interface ShimBind {
    (this: unknown, receiver?: unknown, ...args: unknown[]): LodashCallable;
    call(receiver: unknown, boundReceiver?: unknown, ...args: unknown[]): LodashCallable;
    apply(receiver: unknown, args?: ArrayLike<unknown> | null): LodashCallable;
}
interface ShimPrototypeAllocator { new (): object; prototype: unknown; }
function isShimPrototypeAllocator(value: unknown): value is ShimPrototypeAllocator {
    if (typeof value !== "function") return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, "prototype");
    return descriptor !== undefined && descriptor.writable === true;
}
export function shimPrototypeAllocator(value: unknown): ShimPrototypeAllocator {
    if (!isShimPrototypeAllocator(value)) throw new TypeError("Expected the original writable-prototype allocator");
    return value;
}

export interface ShimHasPropertyDescriptors {
    (): boolean;
    hasArrayLengthDefineBug(): boolean | null;
}
export type ShimDefineDataProperty = (object: unknown, property: unknown, value: unknown, nonEnumerable?: boolean | null, nonWritable?: boolean | null, nonConfigurable?: boolean | null, loose?: boolean) => void;
export type ShimSetFunctionLength = <T>(value: T, length: unknown, loose?: boolean) => T;
export interface ShimCallBind {
    (originalFunction: unknown, ...args: unknown[]): LodashCallable;
    apply(...args: unknown[]): LodashCallable;
}

export type ShimPredicate = (value: unknown) => boolean;
export interface ShimArgumentsPredicate {
    (value: unknown): value is IArguments;
    isLegacyArguments?: (value: unknown) => value is IArguments;
}
export interface ShimForEach {
    <T>(list: readonly T[], iterator: (value: T, index: number, list: readonly T[]) => unknown, receiver?: unknown): void;
    (list: string, iterator: (value: string, index: number, list: string) => unknown, receiver?: unknown): void;
    <T>(list: Record<string, T>, iterator: (value: T, key: string, list: Record<string, T>) => unknown, receiver?: unknown): void;
    (list: unknown, iterator: unknown, receiver?: unknown): void;
}
export type ShimWhichTypedArray = (value: unknown) => string | false | null;

export type ShimObjectIs = (left: unknown, right: unknown) => boolean;
export interface ShimObjectIsModule extends ShimObjectIs {
    getPolyfill(): ShimObjectIs;
    implementation: ShimObjectIs;
    shim(): ShimObjectIs;
}
export interface ShimIsNaNModule extends ShimPredicate {
    getPolyfill(): ShimPredicate;
    implementation: ShimPredicate;
    shim(): ShimPredicate;
}
export interface ShimAssign {
    <T extends object, U>(target: T, source: U): T & U;
    <T extends object>(target: T, ...sources: unknown[]): T;
    (target: unknown, ...sources: unknown[]): object;
}
export type ShimDefineProperties = ((object: unknown, map: Record<PropertyKey, unknown>, predicates?: Record<PropertyKey, unknown>) => unknown) & { supportsDescriptors: boolean };
export interface ShimObjectKeys {
    (value: unknown): string[];
    shim(): (value: unknown) => string[];
}
export function shimForInObject(value: unknown): Record<PropertyKey, unknown> | null | undefined {
    if (value === null || value === undefined) return value;
    const boxed: unknown = Object(value);
    if (!isRecord(boxed)) throw new TypeError("Expected the boxed enumeration object");
    return boxed;
}
function isDocumentAllCallable(value: unknown): value is LodashCallable {
    return typeof value === "function" || (typeof document === "object" && value === document.all);
}
export function shimDocumentAllCallable(value: unknown): LodashCallable {
    if (!isDocumentAllCallable(value)) throw new TypeError("Expected the original document.all callable");
    return value;
}
// These wrappers were declared in non-strict source modules. TypeScript modules
// are strict, so keep their original call-entry receiver conversion explicitly.
export function shimSloppyReceiver(value: unknown): object {
    if (value === null || value === undefined) return globalThis;
    if (isRecord(value)) return value;
    const boxed: unknown = Object(value);
    if (!isRecord(boxed)) throw new TypeError("Expected the original boxed call receiver");
    return boxed;
}

export interface ShimUtilSupportTypes {
    isArgumentsObject(value: unknown): value is IArguments;
    isGeneratorFunction(value: unknown): boolean;
    isTypedArray(value: unknown): value is ArrayBufferView<ArrayBufferLike>;
    isPromise(value: unknown): value is Promise<unknown>;
    isArrayBufferView(value: unknown): value is ArrayBufferView<ArrayBufferLike>;
    isUint8Array(value: unknown): value is Uint8Array<ArrayBufferLike>;
    isUint8ClampedArray(value: unknown): value is Uint8ClampedArray<ArrayBufferLike>;
    isUint16Array(value: unknown): value is Uint16Array<ArrayBufferLike>;
    isUint32Array(value: unknown): value is Uint32Array<ArrayBufferLike>;
    isInt8Array(value: unknown): value is Int8Array<ArrayBufferLike>;
    isInt16Array(value: unknown): value is Int16Array<ArrayBufferLike>;
    isInt32Array(value: unknown): value is Int32Array<ArrayBufferLike>;
    isFloat32Array(value: unknown): value is Float32Array<ArrayBufferLike>;
    isFloat64Array(value: unknown): value is Float64Array<ArrayBufferLike>;
    isBigInt64Array(value: unknown): value is BigInt64Array<ArrayBufferLike>;
    isBigUint64Array(value: unknown): value is BigUint64Array<ArrayBufferLike>;
    isMap(value: unknown): value is Map<unknown, unknown>;
    isSet(value: unknown): value is Set<unknown>;
    isWeakMap(value: unknown): value is WeakMap<WeakKey, unknown>;
    isWeakSet(value: unknown): value is WeakSet<WeakKey>;
    isArrayBuffer(value: unknown): value is ArrayBuffer;
    isDataView(value: unknown): value is DataView<ArrayBufferLike>;
    isSharedArrayBuffer(value: unknown): value is SharedArrayBuffer;
    isAsyncFunction(value: unknown): boolean;
    isMapIterator(value: unknown): boolean;
    isSetIterator(value: unknown): boolean;
    isGeneratorObject(value: unknown): boolean;
    isWebAssemblyCompiledModule(value: unknown): boolean;
    isNumberObject(value: unknown): value is Number;
    isStringObject(value: unknown): value is String;
    isBooleanObject(value: unknown): value is Boolean;
    isBigIntObject(value: unknown): value is BigInt;
    isSymbolObject(value: unknown): value is Symbol;
    isBoxedPrimitive(value: unknown): value is Number | String | Boolean | BigInt | Symbol;
    isAnyArrayBuffer(value: unknown): value is ArrayBufferLike;
    isProxy(...args: unknown[]): never;
    isExternal(...args: unknown[]): never;
    isModuleNamespaceObject(...args: unknown[]): never;
    isRegExp?: (value: unknown) => value is RegExp;
    isDate?: (value: unknown) => value is Date;
    isNativeError?: (value: unknown) => value is Error;
}
export interface ShimUtilTypes extends ShimUtilSupportTypes {
    isRegExp(value: unknown): value is RegExp;
    isDate(value: unknown): value is Date;
    isNativeError(value: unknown): value is Error;
}
export interface InspectOptions {
    showHidden?: boolean;
    depth?: number | null;
    colors?: boolean;
    customInspect?: boolean;
    [key: string]: unknown;
}
export interface ShimInspect {
    (value: unknown, options?: InspectOptions | object | boolean): string;
    (value: unknown, showHidden: boolean, depth: number | null, colors?: boolean): string;
    colors: Record<string, number[]>;
    styles: Record<string, string>;
    custom?: symbol;
}
export interface ShimPromisify {
    (value: unknown): LodashCallable;
    custom?: symbol;
}
export interface ShimUtil {
    format(value?: unknown, ...args: unknown[]): string;
    deprecate(value: unknown, message?: string): unknown;
    debuglog(set: string): LodashCallable;
    inspect: ShimInspect;
    types: ShimUtilTypes;
    isArray(value: unknown): value is unknown[];
    isBoolean(value: unknown): value is boolean;
    isNull(value: unknown): value is null;
    isNullOrUndefined(value: unknown): value is null | undefined;
    isNumber(value: unknown): value is number;
    isString(value: unknown): value is string;
    isSymbol(value: unknown): value is symbol;
    isUndefined(value: unknown): value is undefined;
    isRegExp(value: unknown): value is RegExp;
    isObject(value: unknown): value is object;
    isDate(value: unknown): value is Date;
    isError(value: unknown): value is Error;
    isFunction(value: unknown): value is LodashCallable;
    isPrimitive(value: unknown): boolean;
    isBuffer(value: unknown): unknown;
    log(...args: unknown[]): void;
    inherits(ctor: unknown, superCtor: unknown): void;
    _extend(origin: unknown, add: unknown): unknown;
    promisify: ShimPromisify;
    callbackify(value: unknown): LodashCallable;
}
