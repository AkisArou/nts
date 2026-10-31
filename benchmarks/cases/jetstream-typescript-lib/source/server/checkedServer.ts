// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Added typed layout/read boundaries for the TypeScript 5.9.2 transcription.
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
// Checked object and callable boundaries for the original server protocols.
import { dictionaryValue, isDictionary } from "../checked.ts";
import type { CachedDirectoryStructureHost, CodeActionCommand, CompilerOptions, DirectoryStructureHost, FormatCodeSettings, PluginImport, SymbolDisplayPart, TextSpan } from "./_namespaces/ts.ts";
import type { HandlerResponse, PerformanceData } from "./session.ts";
import type { PluginModule } from "./project.ts";
import type * as protocol from "./protocol.ts";

export function serverProperty(value: unknown, key: string): unknown {
    if (value === null || value === undefined) throw new TypeError("Cannot read a nullish server value");
    const boxed: unknown = Object(value);
    return dictionaryValue(boxed)[key];
}

export function optionalServerBoolean(value: unknown): boolean | undefined {
    if (value !== undefined && typeof value !== "boolean") throw new TypeError("Expected an optional server boolean");
    return value;
}

export function optionalServerString(value: unknown): string | undefined {
    if (value !== undefined && typeof value !== "string") throw new TypeError("Expected an optional server string");
    return value;
}

export function pluginModuleValue(value: unknown): PluginModule {
    if (!isPluginModule(value)) throw new TypeError("Expected a plugin module");
    return value;
}

function isPluginModule(value: unknown): value is PluginModule {
    return isDictionary(value) && typeof value.create === "function" &&
        (value.getExternalFiles === undefined || typeof value.getExternalFiles === "function") &&
        (value.onConfigurationChanged === undefined || typeof value.onConfigurationChanged === "function");
}

export function pluginImportValue(value: unknown): PluginImport {
    if (!isPluginImport(value)) throw new TypeError("Expected a named plugin configuration");
    return value;
}

function isPluginImport(value: unknown): value is PluginImport {
    return isDictionary(value) && typeof value.name === "string" &&
        (value.global === undefined || typeof value.global === "boolean");
}

export function formatSettingsValue(value: protocol.FormatCodeSettings): FormatCodeSettings {
    if (!isFormatSettings(value)) throw new TypeError("Expected converted format settings");
    return value;
}

function isFormatSettings(value: protocol.FormatCodeSettings): value is FormatCodeSettings {
    return value.indentStyle === undefined || typeof value.indentStyle === "number";
}

export function compilerOptionsValue(value: protocol.ExternalProjectCompilerOptions): CompilerOptions & protocol.CompileOnSaveMixin {
    if (!isCompilerOptions(value)) throw new TypeError("Expected converted compiler options");
    return value;
}

function isCompilerOptions(value: protocol.ExternalProjectCompilerOptions): value is protocol.ExternalProjectCompilerOptions & CompilerOptions {
    return (value.jsx === undefined || typeof value.jsx === "number") &&
        (value.module === undefined || typeof value.module === "number") &&
        (value.moduleResolution === undefined || typeof value.moduleResolution === "number") &&
        (value.newLine === undefined || typeof value.newLine === "number") &&
        (value.target === undefined || typeof value.target === "number");
}

export function numericOptionMap(value: Map<string, string | number>): Map<string, number> {
    if (!isNumericOptionMap(value)) throw new TypeError("Expected numeric option values");
    return value;
}

function isNumericOptionMap(value: Map<string, string | number>): value is Map<string, number> {
    for (const item of value.values()) if (typeof item !== "number") return false;
    return true;
}

function isStringArray(value: unknown): value is string[] {
    if (!Array.isArray(value)) return false;
    const items: readonly unknown[] = value;
    return items.every(item => typeof item === "string");
}

function isWatchChangeArgs(value: unknown): value is protocol.WatchChangeRequestArgs {
    return isDictionary(value) && typeof value.id === "number" &&
        (value.created === undefined || isStringArray(value.created)) &&
        (value.deleted === undefined || isStringArray(value.deleted)) &&
        (value.updated === undefined || isStringArray(value.updated));
}

function isWatchChanges(value: unknown): value is protocol.WatchChangeRequestArgs | readonly protocol.WatchChangeRequestArgs[] {
    if (!Array.isArray(value)) return isWatchChangeArgs(value);
    const items: readonly unknown[] = value;
    return items.every(isWatchChangeArgs);
}

export function watchChangesValue(value: unknown): protocol.WatchChangeRequestArgs | readonly protocol.WatchChangeRequestArgs[] {
    if (!isWatchChanges(value)) throw new TypeError("Expected file watch change arguments");
    return value;
}

export function fileRequestValue(value: unknown): protocol.FileRequestArgs {
    if (!isFileRequestArgs(value)) throw new TypeError("Expected file request arguments");
    return value;
}

function isFileRequestArgs(value: unknown): value is protocol.FileRequestArgs {
    return isDictionary(value) && typeof value.file === "string" &&
        (value.projectFileName === undefined || typeof value.projectFileName === "string");
}

function isRequest(value: unknown): value is protocol.Request {
    return isDictionary(value) && typeof value.seq === "number" && value.type === "request" && typeof value.command === "string";
}

export function serverRequestValue(value: unknown): protocol.Request {
    if (!isRequest(value)) throw new TypeError("Expected a server request");
    return value;
}

export function displayPartTarget(value: SymbolDisplayPart): { fileName: string; textSpan: TextSpan } {
    const target = dictionaryValue(value).target;
    if (!isDisplayPartTarget(target)) throw new TypeError("Expected a documentation link target");
    return target;
}

function isDisplayPartTarget(value: unknown): value is { fileName: string; textSpan: TextSpan } {
    return isDictionary(value) && typeof value.fileName === "string" && isDictionary(value.textSpan) &&
        typeof value.textSpan.start === "number" && typeof value.textSpan.length === "number";
}

export function codeActionCommandValue(value: unknown): CodeActionCommand {
    if (!isCodeActionCommand(value)) throw new TypeError("Expected an install package command");
    return value;
}

function isCodeActionCommand(value: unknown): value is CodeActionCommand {
    return isDictionary(value) && value.type === "install package" &&
        typeof value.file === "string" && typeof value.packageName === "string";
}

// Error's message uses ToString, including its undefined and Symbol cases.
export function errorMessageValue(value: unknown): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value === "symbol") throw new TypeError("Cannot convert a Symbol value to a string");
    return String(value);
}

export function isCachedDirectoryStructureHost(value: DirectoryStructureHost): value is CachedDirectoryStructureHost {
    const fields = dictionaryValue(value);
    return typeof fields.useCaseSensitiveFileNames === "boolean" &&
        typeof fields.getDirectories === "function" && typeof fields.readDirectory === "function" &&
        typeof fields.addOrDeleteFileOrDirectory === "function" && typeof fields.addOrDeleteFile === "function" &&
        typeof fields.clearCache === "function";
}

function isDiagnosticPerformanceData(value: unknown): value is protocol.DiagnosticPerformanceData {
    if (!isDictionary(value)) return false;
    return (value.semanticDiag === undefined || typeof value.semanticDiag === "number") &&
        (value.syntaxDiag === undefined || typeof value.syntaxDiag === "number") &&
        (value.suggestionDiag === undefined || typeof value.suggestionDiag === "number");
}

function isPerformanceData(value: unknown): value is PerformanceData {
    if (!isDictionary(value)) return false;
    if (value.updateGraphDurationMs !== undefined && typeof value.updateGraphDurationMs !== "number") return false;
    if (value.createAutoImportProviderProgramDurationMs !== undefined && typeof value.createAutoImportProviderProgramDurationMs !== "number") return false;
    if (value.diagnosticsDuration === undefined) return true;
    if (!(value.diagnosticsDuration instanceof Map)) return false;
    const durations: Map<unknown, unknown> = value.diagnosticsDuration;
    for (const [file, duration] of durations) {
        if (typeof file !== "string" || !isDiagnosticPerformanceData(duration)) return false;
    }
    return true;
}

function isHandlerResponse(value: unknown): value is HandlerResponse {
    return isDictionary(value) && value.response !== null &&
        (value.responseRequired === undefined || typeof value.responseRequired === "boolean") &&
        (value.performanceData === undefined || isPerformanceData(value.performanceData));
}

export function invokeServerHandler(handler: (request: never) => HandlerResponse, request: protocol.Request): HandlerResponse {
    const callable: unknown = handler;
    if (typeof callable !== "function") throw new TypeError("Expected a server request handler");
    const result: unknown = callable(request);
    if (!isHandlerResponse(result)) throw new TypeError("Expected a server handler response");
    return result;
}
