// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Added typed layout/read boundaries for the TypeScript 5.9.2 transcription.
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
// Checked construction phases of the original TypeScript watch host objects.
// Every helper returns the existing receiver or tests its existing fields.
import type {CompilerHost, WatchOptions, BuildInfo} from './types.ts';
import type {BuilderProgram} from './builderPublic.ts';
import type {ProgramHost, WatchHost, WatchCompilerHost} from './watchPublic.ts';
import type {ResolutionCacheHost} from './resolutionCache.ts';
export function isCompleteWatchHost<T extends BuilderProgram>(value: ProgramHost<T> & Partial<WatchCompilerHost<T>>): value is WatchCompilerHost<T> {
    return typeof value.watchFile === 'function' && typeof value.watchDirectory === 'function';
}
export function isCompleteResolutionHost(value: CompilerHost & Partial<ResolutionCacheHost>): value is CompilerHost & ResolutionCacheHost {
    return typeof value.toPath === 'function' && typeof value.getCompilationSettings === 'function'
        && typeof value.watchDirectoryOfFailedLookupLocation === 'function' && typeof value.watchAffectingFileLocation === 'function'
        && typeof value.watchTypeRootsDirectory === 'function' && typeof value.getCachedDirectoryStructureHost === 'function'
        && typeof value.scheduleInvalidateResolutionsOfFailedLookupLocations === 'function' && typeof value.onInvalidatedResolution === 'function'
        && typeof value.onChangedAutomaticTypeDirectiveNames === 'function' && typeof value.fileIsOpen === 'function'
        && typeof value.getCurrentProgram === 'function' && typeof value.writeLog === 'function'
        && 'preferNonRecursiveWatch' in value;
}
export function isWatchOptionsValue<T>(value: WatchOptions | readonly T[]): value is WatchOptions { return !Array.isArray(value); }
export function isWatchArray<T>(value: WatchOptions | readonly T[]): value is readonly T[] { return Array.isArray(value); }
export function isWatchBuildInfo(value: unknown): value is BuildInfo {
    return value !== null && typeof value === 'object' && 'version' in value && typeof value.version === 'string';
}
