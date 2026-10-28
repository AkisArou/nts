// Typed public contracts for the pinned Lodash 4.17.21 modules.
// Runtime checks are confined to the CommonJS export boundary.
import {isRecord} from "./webpack.ts";
export interface Curried2<A, B, R> { (a: A, b: B): R; (a: A): (b: B) => R; }
export interface Curried3<A, B, C, R> { (a: A, b: B, c: C): R; (a: A, b: B): (c: C) => R; (a: A): Curried2<B, C, R>; }
export type Falsy = false | null | undefined | 0 | "";
export interface LodashFP {
  [name: string]: unknown;
  compact<T>(array: readonly (T | Falsy)[]): T[];
  curry<A, B, C, R>(func: (a: A, b: B, c: C) => R): Curried3<A, B, C, R>;
  curry<A, B, R>(func: (a: A, b: B) => R): Curried2<A, B, R>;
  curry<A, R>(func: (a: A) => R): (a: A) => R;
  find<T>(predicate: (value: T) => unknown, array: readonly T[]): T | undefined;
  flatMap<T, R>(iteratee: (value: T) => R | readonly R[], array: readonly T[]): R[];
  flatMap<T, R>(iteratee: (value: T) => R | readonly R[]): (array: readonly T[]) => R[];
  flatten<T>(array: readonly (T | readonly T[])[]): T[];
  flow<A, B, C>(first: (value: A) => B, second: (value: B) => C): (value: A) => C;
  flow<A, B, C, D>(first: (value: A) => B, second: (value: B) => C, third: (value: C) => D): (value: A) => D;
  forEach<T>(iteratee: (value: T) => unknown): (array: T[]) => T[];
  forEach<T>(iteratee: (value: T) => unknown, array: T[]): T[];
  includes<T>(value: T, collection: readonly T[]): boolean;
  includes(value: string, collection: string): boolean;
  isArray(value: unknown): value is unknown[];
  isEqual(value: unknown, other: unknown): boolean;
  isEqualWith(customizer: (value: unknown, other: unknown, key?: unknown, object?: unknown, otherObject?: unknown, stack?: unknown) => unknown, value: unknown, other: unknown): boolean;
  isMatchWith(customizer: (value: unknown, matcher: unknown, key?: string, object?: unknown, source?: unknown, stack?: unknown) => unknown, source: unknown, object: unknown): boolean;
  isNull(value: unknown): value is null;
  isObjectLike(value: unknown): value is Record<PropertyKey, unknown>;
  isString(value: unknown): value is string | String;
  map<T, R>(iteratee: (value: T) => R, array: readonly T[]): R[];
  map<T, R>(iteratee: (value: T) => R): (array: readonly T[]) => R[];
  mapValues<T, R>(iteratee: (value: T) => R): (object: Record<string, T>) => Record<string, R>;
  matches(source: unknown): (object: unknown) => boolean;
  min(array: readonly number[]): number | undefined;
  negate<A extends unknown[]>(predicate: (...args: A) => unknown): (...args: A) => boolean;
  omit<K extends PropertyKey>(paths: readonly K[]): <T extends object>(object: T) => Omit<T, K>;
  some<T>(predicate: (value: T) => unknown): (array: readonly T[]) => boolean;
  some<T>(predicate: (value: T) => unknown, array: readonly T[]): boolean;
  sortBy<T>(iteratee: keyof T, collection: readonly T[]): T[];
  tail<T>(array: readonly T[]): T[];
  uniq<T>(array: readonly T[]): T[];
  values<T extends object>(object: T): T[keyof T][];
}
const fpMethods = ["compact", "curry", "find", "flatMap", "flatten", "flow", "forEach", "includes", "isArray", "isEqual", "isEqualWith", "isMatchWith", "isNull", "isObjectLike", "isString", "map", "mapValues", "matches", "min", "negate", "omit", "some", "sortBy", "tail", "uniq", "values"];
export function isLodashFP(value: unknown): value is LodashFP {
  return isRecord(value) && fpMethods.every(name => typeof value[name] === "function");
}
export interface LodashInstance {
  [name: string]: unknown;
  (value?: unknown): unknown;
  runInContext(context?: object): LodashInstance;
  defaults<T extends object>(object: T, ...sources: unknown[]): T & Record<PropertyKey, unknown>;
  pick(object: unknown, paths: readonly PropertyKey[]): Record<PropertyKey, unknown>;
}
export function isLodashInstance(value: unknown): value is LodashInstance {
  return typeof value === "function" && "runInContext" in value && typeof value.runInContext === "function" && "defaults" in value && typeof value.defaults === "function" && "pick" in value && typeof value.pick === "function";
}
export function instanceValue(value: unknown): LodashInstance {
  if (!isLodashInstance(value)) throw new TypeError("Expected the complete pinned Lodash instance");
  return value;
}
