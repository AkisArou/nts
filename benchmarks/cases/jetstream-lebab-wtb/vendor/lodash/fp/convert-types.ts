// Named method contracts used by Lodash's unchanged FP converter.
import {isRecord} from "../../../webpack.ts";
import {propertyKey, type LodashCallable, type LodashDynamicFunction, type LodashFunction} from "../runtime.ts";

export type Arity = number | string;
export interface ConvertHelpers {
    ary(func: LodashFunction, arity: Arity): LodashDynamicFunction;
    assign<T extends object>(target: T, source?: unknown): T & Record<PropertyKey, unknown>;
    clone(value: unknown): unknown;
    curry(func: LodashFunction, arity: Arity): LodashDynamicFunction;
    forEach<T>(collection: ArrayLike<T> | null | undefined, iteratee: (value: T, index: number, array: ArrayLike<T>) => unknown): unknown;
    isArray(value: unknown): value is unknown[];
    isError(value: unknown): value is Error;
    isFunction(value: unknown): value is LodashCallable;
    isWeakMap(value: unknown): value is WeakMap<object, unknown>;
    iteratee(value: unknown, arity?: unknown): LodashDynamicFunction;
    keys(value: unknown): string[];
    rearg(func: LodashFunction, indexes?: number[]): LodashDynamicFunction;
    toInteger(value: unknown): number;
    toPath(value: unknown): PropertyKey[];
}
function isConvertHelpers(value: unknown): value is ConvertHelpers {
    return isRecord(value) && ["ary", "assign", "clone", "curry", "forEach", "isArray", "isError", "isFunction", "isWeakMap", "iteratee", "keys", "rearg", "toInteger", "toPath"].every(name => typeof value[name] === "function");
}
export function convertHelpers(value: unknown): ConvertHelpers {
    if (!isConvertHelpers(value)) throw new TypeError("Expected the pinned Lodash converter methods");
    return value;
}
export type BaseConvert = (util: ConvertHelpers, name: unknown, func?: unknown, options?: unknown) => unknown;
export function isBaseConvert(value: unknown): value is BaseConvert { return typeof value === "function"; }
export function mappingEntry<T>(mapping: Record<PropertyKey, T>, name: unknown): T | undefined {
    return mapping[propertyKey(name)];
}
