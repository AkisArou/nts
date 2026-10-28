import {isRecord} from "../../../webpack.ts";
export interface MappingExports {
  aliasToReal: Record<string, string>;
  aryMethod: Record<string, string[]>;
  aryRearg: Record<string, number[]>;
  iterateeAry: Record<string, number>;
  iterateeRearg: Record<string, number[]>;
  methodRearg: Record<string, number[]>;
  methodSpread: Record<string, {start: number; afterRearg?: boolean}>;
  mutate: {array: Record<string, boolean>; object: Record<string, boolean>; set: Record<string, boolean>};
  realToAlias: Record<string, string[]>;
  remap: Record<string, string>;
  skipFixed: Record<string, boolean>;
  skipRearg: Record<string, boolean>;
}
function stringValue(value: unknown): value is string { return typeof value === "string"; }
function numberValue(value: unknown): value is number { return typeof value === "number"; }
function booleanValue(value: unknown): value is boolean { return typeof value === "boolean"; }
function arrayOf<T>(value: unknown, test: (value: unknown) => value is T): value is T[] {
  if (!Array.isArray(value)) return false;
  const values: unknown[] = value;
  return values.every(test);
}
function strings(value: unknown): value is string[] { return arrayOf(value, stringValue); }
function numbers(value: unknown): value is number[] { return arrayOf(value, numberValue); }
function recordOf<T>(value: unknown, test: (value: unknown) => value is T): value is Record<string, T> {
  return isRecord(value) && Object.keys(value).every(key => test(value[key]));
}
function spread(value: unknown): value is {start: number; afterRearg?: boolean} {
  return isRecord(value) && typeof value.start === "number" && (value.afterRearg === undefined || typeof value.afterRearg === "boolean");
}
export function isMappingExports(value: unknown): value is MappingExports {
  return isRecord(value) && recordOf(value.aliasToReal, stringValue) &&
    recordOf(value.aryMethod, strings) && recordOf(value.aryRearg, numbers) &&
    recordOf(value.iterateeAry, numberValue) && recordOf(value.iterateeRearg, numbers) &&
    recordOf(value.methodRearg, numbers) && recordOf(value.methodSpread, spread) &&
    isRecord(value.mutate) && recordOf(value.mutate.array, booleanValue) &&
    recordOf(value.mutate.object, booleanValue) && recordOf(value.mutate.set, booleanValue) &&
    recordOf(value.realToAlias, strings) && recordOf(value.remap, stringValue) &&
    recordOf(value.skipFixed, booleanValue) && recordOf(value.skipRearg, booleanValue);
}
