// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Added typed layout/read boundaries for the TypeScript 5.9.2 transcription.
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
// Checked views at the points where the original resolver consumes path maps.
// Raw JSON stays in its original cache; these functions retain receiver identity.
import {compilerPropertyObject} from '../checked.ts';
import type {MapLike} from './corePublic.ts';
import type {VersionPaths} from './moduleNameResolver.ts';
export function packageJsonProperties(value: unknown): Record<string, unknown> | null | undefined {
    if (value === null || value === undefined) return value;
    return compilerPropertyObject(value);
}
export function isPackagePathMapping(value: unknown): value is MapLike<string[]> {
    if (value === null || typeof value !== 'object') return false;
    const entries = compilerPropertyObject(value);
    return Object.keys(entries).every(key => isPackagePathList(entries[key]));
}
function isPackagePathList(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((item: unknown) => typeof item === 'string');
}
export function isVersionPathMapping(value: VersionPaths<unknown>): value is VersionPaths {
    return isPackagePathMapping(value.paths);
}
