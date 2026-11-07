// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/jsTyping/shared.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
interface NamespaceLayout_Arguments {
    GlobalCacheLocation: "--globalTypingsCacheLocation";
    LogFile: "--logFile";
    EnableTelemetry: "--enableTelemetry";
    TypingSafeListLocation: "--typingSafeListLocation";
    TypesMapLocation: "--typesMapLocation";
    NpmLocation: "--npmLocation";
    ValidateDefaultNpmLocation: "--validateDefaultNpmLocation";
}
import { present } from "../checked.ts";
import { sys } from "./_namespaces/ts.ts";
export type ActionSet = "action::set";
export type ActionInvalidate = "action::invalidate";
export type ActionPackageInstalled = "action::packageInstalled";
export type EventTypesRegistry = "event::typesRegistry";
export type EventBeginInstallTypes = "event::beginInstallTypes";
export type EventEndInstallTypes = "event::endInstallTypes";
export type EventInitializationFailed = "event::initializationFailed";
export type ActionWatchTypingLocations = "action::watchTypingLocations";
/** @internal */
export const ActionSet: ActionSet = "action::set";
/** @internal */
export const ActionInvalidate: ActionInvalidate = "action::invalidate";
/** @internal */
export const ActionPackageInstalled: ActionPackageInstalled = "action::packageInstalled";
/** @internal */
export const EventTypesRegistry: EventTypesRegistry = "event::typesRegistry";
/** @internal */
export const EventBeginInstallTypes: EventBeginInstallTypes = "event::beginInstallTypes";
/** @internal */
export const EventEndInstallTypes: EventEndInstallTypes = "event::endInstallTypes";
/** @internal */
export const EventInitializationFailed: EventInitializationFailed = "event::initializationFailed";
/** @internal */
export const ActionWatchTypingLocations: ActionWatchTypingLocations = "action::watchTypingLocations";
export const Arguments: NamespaceLayout_Arguments = (function (): NamespaceLayout_Arguments {
    const GlobalCacheLocation = "--globalTypingsCacheLocation";
    const LogFile = "--logFile";
    const EnableTelemetry = "--enableTelemetry";
    const TypingSafeListLocation = "--typingSafeListLocation";
    const TypesMapLocation = "--typesMapLocation";
    /**
     * This argument specifies the location of the NPM executable.
     * typingsInstaller will run the command with `${npmLocation} install ...`.
     */
    const NpmLocation = "--npmLocation";
    /**
     * Flag indicating that the typings installer should try to validate the default npm location.
     * If the default npm is not found when this flag is enabled, fallback to `npm install`
     */
    const ValidateDefaultNpmLocation = "--validateDefaultNpmLocation";
    return {
        GlobalCacheLocation,
        LogFile,
        EnableTelemetry,
        TypingSafeListLocation,
        TypesMapLocation,
        NpmLocation,
        ValidateDefaultNpmLocation
    };
})();
/** @internal */
export function hasArgument(argumentName: string): boolean {
    return (sys)!.args.includes(argumentName);
}
/** @internal */
export function findArgument(argumentName: string): string | undefined {
    const index = (sys)!.args.indexOf(argumentName);
    return index >= 0 && index < (sys)!.args.length - 1
        ? (sys)!.args[index + 1]
        : undefined;
}
/** @internal */
export function nowString() {
    // E.g. "12:34:56.789"
    const d = new Date();
    return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}.${d.getMilliseconds().toString().padStart(3, "0")}`;
}
const indentStr = "\n    ";
/** @internal */
export function indent(str: string): string {
    return indentStr + str.replace(/\n/g, indentStr);
}
/**
 * Put stringified JSON on the next line, indented.
 *
 * @internal
 */
export function stringifyIndented(json: unknown): string {
    return indent(JSON.stringify(json, undefined, 2));
}
