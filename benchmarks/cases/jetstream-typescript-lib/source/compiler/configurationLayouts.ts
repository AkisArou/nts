// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Added typed layout/read boundaries for the TypeScript 5.9.2 transcription.
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
// Checked views of the original configuration parser's option/value phases.
import { isDictionary } from "../checked.ts";
import type { CommandLineOption, CommandLineOptionOfCustomType, CompilerOptionsValue } from "./types.ts";
import type { MapLike } from "./corePublic.ts";
import type { BuildOptions } from "./tsbuildPublic.ts";
import type { OptionsBase } from "./commandLineParser.ts";
export function checkedCustomOption(option: CommandLineOption): CommandLineOptionOfCustomType {
    if (typeof option.type !== "string") return option;
    throw new TypeError("Expected custom compiler option");
}
export function checkedCompilerOptionValue(value: unknown): CompilerOptionsValue {
    if (value === undefined || value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
    if (Array.isArray(value)) return value;
    if (isDictionary(value) && typeof value === "object") return value;
    throw new TypeError("Expected compiler option value");
}
export function checkedOptionArray(value: unknown): unknown[] {
    if (Array.isArray(value)) return value;
    throw new TypeError("Expected compiler option array");
}
function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((entry: unknown) => typeof entry === "string");
}
export function checkedStringArray(value: unknown): string[] {
    if (isStringArray(value)) return value;
    throw new TypeError("Expected compiler string array");
}
function isStringArrayMap(value: unknown): value is MapLike<string[]> {
    return isDictionary(value) && Object.values(value).every(isStringArray);
}
export function checkedStringArrayMap(value: unknown): MapLike<string[]> {
    if (isStringArrayMap(value)) return value;
    throw new TypeError("Expected compiler string-array map");
}
function isBuildOptions(value: OptionsBase): value is BuildOptions {
    for (const key of ["dry", "force", "verbose", "stopBuildOnErrors", "clean", "watch", "help", "preserveWatchOutput", "listEmittedFiles", "listFiles", "explainFiles", "pretty", "incremental", "assumeChangesOnlyAffectDirectDependencies", "declaration", "declarationMap", "emitDeclarationOnly", "sourceMap", "inlineSourceMap", "traceResolution", "diagnostics", "extendedDiagnostics"]) {
        if (value[key] !== undefined && typeof value[key] !== "boolean") return false;
    }
    for (const key of ["locale", "generateCpuProfile", "generateTrace"]) {
        if (value[key] !== undefined && typeof value[key] !== "string") return false;
    }
    return true;
}
export function checkedBuildOptions(value: OptionsBase): BuildOptions {
    if (isBuildOptions(value)) return value;
    throw new TypeError("Expected build options");
}
