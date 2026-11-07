// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Added typed layout/read boundaries for the TypeScript 5.9.2 transcription.
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
// Native mutable arrays are exposed through readonly compiler API views.
// These readers keep the original object and check its runtime representation.
function isMutableServiceArray<T>(value: readonly T[]): value is T[] {
    return Array.isArray(value);
}
export function mutableServiceArray<T>(value: readonly T[]): T[] {
    if (isMutableServiceArray(value)) return value;
    throw new TypeError("Expected a native compiler array");
}
