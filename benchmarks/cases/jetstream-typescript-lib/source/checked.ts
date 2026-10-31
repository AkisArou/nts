// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Added typed layout/read boundaries for the TypeScript 5.9.2 transcription.
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
// Checked narrowing used while transcribing the original compiler's erased views.
export function present<T>(value: T | null | undefined): T {
    if (value === null || value === undefined) throw new TypeError("Missing compiler phase value");
    return value;
}
export function checkedCompilerLayout<T, U extends T>(value: T, predicate: (value: T) => value is U): U;
export function checkedCompilerLayout<T, U extends T>(value: T | undefined, predicate: (value: T) => value is U): U | undefined;
export function checkedCompilerLayout<T, U extends T>(value: T | null | undefined, predicate: (value: T) => value is U): U | null | undefined;
export function checkedCompilerLayout<T, U extends T>(value: T | null | undefined, predicate: (value: T) => value is U): U | null | undefined {
    if (value === null) return null;
    if (value === undefined) return undefined;
    if (predicate(value)) return value;
    throw new TypeError("Unexpected compiler layout for " + predicate.name);
}
export function stringValue(value: unknown): string {
    if (typeof value === "string") return value;
    throw new TypeError("Expected compiler string");
}
export function numberValue(value: unknown): number {
    if (typeof value === "number") return value;
    throw new TypeError("Expected compiler number");
}
export function booleanValue(value: unknown): boolean {
    if (typeof value === "boolean") return value;
    throw new TypeError("Expected compiler boolean");
}
export function isDictionary(value: unknown): value is Record<string, unknown> {
    return value !== null && (typeof value === "object" || typeof value === "function");
}
export function dictionaryValue(value: unknown): Record<string, unknown> {
    if (isDictionary(value)) return value;
    throw new TypeError("Expected compiler dictionary");
}

/** Required-value guard that preserves TypeScript narrowing of the original variable. */
export function testCompilerLayout<T, U extends T>(value: T | null | undefined, predicate: (value: T) => value is U): value is U {
    return predicate((value)!);
}

export type PresentCompilerMember<T extends object, K extends keyof T> = T & { [P in K]-?: NonNullable<T[P]> };
function hasCompilerMember<T extends object, K extends keyof T>(value: T, key: K): value is PresentCompilerMember<T, K> {
    const member = value[key];
    return member !== undefined && member !== null;
}
/** Validate a late/optional member while retaining the original receiver object. */
export function requireCompilerMember<T extends object, K extends keyof T>(value: T, key: K): PresentCompilerMember<T, K> {
    if (hasCompilerMember(value, key)) return value;
    throw new TypeError("Missing compiler member " + String(key));
}

/** The original property reads use JavaScript's ToObject conversion for primitives. */
export function compilerPropertyObject(value: unknown): Record<string, unknown> {
    if (value === null || value === undefined) throw new TypeError("Cannot read compiler value property");
    const boxed: unknown = Object(value);
    return dictionaryValue(boxed);
}

function isCompilerMapValue<K, V>(value: V | undefined, map: ReadonlyMap<K, V>, key: K): value is V {
    return value !== undefined || (map.has(key) && map.get(key) === value);
}
/** A stored undefined is a valid V; do not treat it as an absent cache entry. */
export function compilerMapValue<K, V>(value: V | undefined, map: ReadonlyMap<K, V>, key: K): V {
    if (isCompilerMapValue(value, map, key)) return value;
    throw new TypeError("Missing compiler map entry");
}

// Optional engine debugging fields read by the original dormant host helpers.
declare global {
    interface ErrorConstructor {
        captureStackTrace?(target: object, stackCrawlMark?: (...args: never[]) => unknown): void;
        stackTraceLimit?: number;
    }
}
