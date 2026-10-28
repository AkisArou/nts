// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/compiler/corePublic.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
// WARNING: The script `configurePrerelease.ts` uses a regexp to parse out these values.
// If changing the text in this section, be sure to test `configurePrerelease` too.
export const versionMajorMinor = "5.9";
// The following is baselined as a literal template type without intervention
/** The version of the TypeScript compiler release */
export const version = "5.9.2";
/**
 * Type of objects whose values are all of the same type.
 * The `in` and `for-in` operators can *not* be safely used,
 * since `Object.prototype` may be modified by outside code.
 */
export interface MapLike<T> {
    [index: string]: T;
}
export interface SortedReadonlyArray<T> extends ReadonlyArray<T> {
}
export interface SortedArray<T> extends Array<T> {
}
/**
 * Common read methods for ES6 Map/Set.
 *
 * @internal
 */
export interface ReadonlyCollection<K> {
    size: number;
    has(key: K): boolean;
    keys(): IterableIterator<K, unknown, unknown>;
}
/** @internal */
export type EqualityComparer<T> = (a: T, b: T) => boolean;
/** @internal */
export type Comparer<T> = (a: T, b: T) => Comparison;
/** @internal */
export type Comparison = number;
/** @internal */
export const Comparison: {
    readonly LessThan: -1;
    readonly EqualTo: 0;
    readonly GreaterThan: 1;
    [index: number]: string;
} = {
    LessThan: -1,
    "-1": "LessThan",
    EqualTo: 0,
    "0": "EqualTo",
    GreaterThan: 1,
    "1": "GreaterThan"
};
