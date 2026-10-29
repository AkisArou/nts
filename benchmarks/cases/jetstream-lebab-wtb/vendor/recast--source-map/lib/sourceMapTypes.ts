import {runtimeProperty} from "../../../webpack.ts";
// Strict layouts for the unchanged source-map 0.6.1 module bodies.
export type Coordinate = number | false | null | undefined;
export interface Position { line: Coordinate; column: Coordinate; }
export interface GeneratedQuery extends Position { bias?: number; }
export interface OriginalQuery extends Position { source: string; bias?: number; }
export interface OriginalLineQuery { source: string; line: number; column?: number; }
export interface OriginalPosition { source: string | null; line: Coordinate; column: Coordinate; name: string | null | undefined; }
export interface GeneratedPosition { line: Coordinate; column: Coordinate; lastColumn?: number | null; }
export interface ObservedMapping {
    source: string;
    generatedLine: Coordinate;
    generatedColumn: Coordinate;
    originalLine: Coordinate;
    originalColumn: Coordinate;
    name: string | null | undefined;
}
export interface Consumer {
    file: unknown;
    sourceRoot: unknown;
    sources: string[];
    sourcesContent?: unknown;
    eachMapping(callback: (mapping: ObservedMapping, index: number, mappings: ObservedMapping[]) => void, context?: unknown, order?: number): void;
    allGeneratedPositionsFor(args: OriginalLineQuery): GeneratedPosition[];
    originalPositionFor(args: GeneratedQuery): OriginalPosition;
    generatedPositionFor(args: OriginalQuery): GeneratedPosition;
    sourceContentFor(source: string, nullOnMissing?: boolean): unknown;
    hasContentsOfAllSources(): boolean;
}
export interface GeneratorOptions { file?: unknown; sourceRoot?: unknown; skipValidation?: unknown; }
export interface MappingOptions {
    generated: Position;
    original?: Position | null;
    source?: string | null;
    name?: string | null;
}
export interface SourceMapOutput {
    version: number;
    sources: string[];
    names: string[];
    mappings: string;
    file?: unknown;
    sourceRoot?: unknown;
    sourcesContent?: unknown[];
}
export interface OriginalChunk { source: string | null; line: Coordinate; column: Coordinate; name: string | null | undefined; }
export function sourceMapString(value: unknown): string {
    if (typeof value !== "string") throw new TypeError("Expected a source-map string");
    return value;
}
export function sourceMapArray(value: unknown): unknown[] {
    if (value === null || value === undefined) sourceMapProperty(value, "map");
    if (!Array.isArray(value)) throw new TypeError("Expected a source-map array");
    return value;
}


// Raw metadata reaches the same JavaScript property, call, and arithmetic points
// as in the source. These checked boundaries retain native coercion and failures.
export function sourceMapProperty(value: unknown, key: PropertyKey): unknown {
    if (value === null || value === undefined) {
        throw new TypeError("Cannot read properties of " + value + " (reading '" + String(key) + "')");
    }
    return runtimeProperty(value, key);
}
export function sourceMapMethod(value: unknown, key: PropertyKey, args: ArrayLike<unknown>, expression: string): unknown {
    const method = sourceMapProperty(value, key);
    if (typeof method !== "function") throw new TypeError(expression + " is not a function");
    const result: unknown = Function.prototype.apply.call(method, value, args);
    return result;
}
export function sourceMapLess<T>(left: T, right: T): boolean {
    return left < right;
}
type SourceMapPrimitive = string | number | boolean | bigint | symbol | null | undefined;
function isSourceMapPrimitive(value: unknown): value is SourceMapPrimitive {
    return value === null || (typeof value !== "object" && typeof value !== "function");
}
function sourceMapDefaultPrimitive(value: unknown): SourceMapPrimitive {
    if (isSourceMapPrimitive(value)) return value;
    const exotic = sourceMapProperty(value, Symbol.toPrimitive);
    if (exotic !== null && exotic !== undefined) {
        if (typeof exotic !== "function") throw new TypeError(String(exotic) + " is not a function");
        const result: unknown = Function.prototype.call.call(exotic, value, "default");
        if (isSourceMapPrimitive(result)) return result;
        throw new TypeError("Cannot convert object to primitive value");
    }
    const valueOf = sourceMapProperty(value, "valueOf");
    if (typeof valueOf === "function") {
        const result: unknown = Function.prototype.call.call(valueOf, value);
        if (isSourceMapPrimitive(result)) return result;
    }
    const toString = sourceMapProperty(value, "toString");
    if (typeof toString === "function") {
        const result: unknown = Function.prototype.call.call(toString, value);
        if (isSourceMapPrimitive(result)) return result;
    }
    throw new TypeError("Cannot convert object to primitive value");
}
export function sourceMapAddNumber(value: unknown, addend: number): number | string {
    const primitive = sourceMapDefaultPrimitive(value);
    if (typeof primitive === "string") return primitive + addend;
    if (typeof primitive === "bigint") throw new TypeError("Cannot mix BigInt and other types, use explicit conversions");
    return Number(primitive) + addend;
}
