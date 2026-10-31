// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/server/utilitiesPublic.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
interface NamespaceLayout_Errors {
    ThrowNoProject: {
        (): never;
    };
    ThrowProjectLanguageServiceDisabled: {
        (): never;
    };
    ThrowProjectDoesNotContainDocument: {
        (fileName: string, project: Project): never;
    };
}
import { getNormalizedAbsolutePath, isRootedDiskPath, normalizePath, type Path, type SortedArray, type SortedReadonlyArray, type TypeAcquisition } from "./_namespaces/ts.ts";
import { type DiscoverTypings, Project } from "./_namespaces/ts.server.ts";
export type LogLevel = number;
export const LogLevel: {
    readonly terse: 0;
    readonly normal: 1;
    readonly requestTime: 2;
    readonly verbose: 3;
    [index: number]: string;
} = {
    terse: 0,
    "0": "terse",
    normal: 1,
    "1": "normal",
    requestTime: 2,
    "2": "requestTime",
    verbose: 3,
    "3": "verbose"
};
export const emptyArray: SortedReadonlyArray<never> = createSortedArray<never>();
export interface Logger {
    close(): void;
    hasLevel(level: LogLevel): boolean;
    loggingEnabled(): boolean;
    perftrc(s: string): void;
    info(s: string): void;
    startGroup(): void;
    endGroup(): void;
    msg(s: string, type?: Msg): void;
    getLogFileName(): string | undefined;
    /** @internal*/ isTestLogger?: boolean;
}
// TODO: Use a const enum (https://github.com/Microsoft/TypeScript/issues/16804)
export type Msg = "Err" | "Info" | "Perf";
// TODO: Use a const enum (https://github.com/Microsoft/TypeScript/issues/16804)
export const Msg: {
    readonly Err: "Err";
    readonly Info: "Info";
    readonly Perf: "Perf";
} = {
    Err: "Err",
    Info: "Info",
    Perf: "Perf"
};
export function createInstallTypingsRequest(project: Project, typeAcquisition: TypeAcquisition, unresolvedImports: SortedReadonlyArray<string>, cachePath?: string): DiscoverTypings {
    return {
        projectName: project.getProjectName(),
        fileNames: project.getFileNames(/*excludeFilesFromExternalLibraries*/ true, /*excludeConfigFiles*/ true).concat(project.getExcludedFiles()),
        compilerOptions: project.getCompilationSettings(),
        typeAcquisition,
        unresolvedImports,
        projectRootPath: project.getCurrentDirectory(),
        cachePath,
        kind: "discover",
    };
}
export const Errors: NamespaceLayout_Errors = (function (): NamespaceLayout_Errors {
    function ThrowNoProject(): never {
        throw new Error("No Project.");
    }
    function ThrowProjectLanguageServiceDisabled(): never {
        throw new Error("The project's language service is disabled.");
    }
    function ThrowProjectDoesNotContainDocument(fileName: string, project: Project): never {
        throw new Error(`Project '${project.getProjectName()}' does not contain document '${fileName}'`);
    }
    return {
        ThrowNoProject,
        ThrowProjectLanguageServiceDisabled,
        ThrowProjectDoesNotContainDocument
    };
})();
export type NormalizedPath = string;
export function toNormalizedPath(fileName: string): NormalizedPath {
    return normalizePath(fileName);
}
export function normalizedPathToPath(normalizedPath: NormalizedPath, currentDirectory: string, getCanonicalFileName: (f: string) => string): Path {
    const f = isRootedDiskPath(normalizedPath) ? normalizedPath : getNormalizedAbsolutePath(normalizedPath, currentDirectory);
    return getCanonicalFileName(f);
}
export function asNormalizedPath(fileName: string): NormalizedPath {
    return fileName;
}
export interface NormalizedPathMap<T> {
    get(path: NormalizedPath): T | undefined;
    set(path: NormalizedPath, value: T): void;
    contains(path: NormalizedPath): boolean;
    remove(path: NormalizedPath): void;
}
export function createNormalizedPathMap<T>(): NormalizedPathMap<T> {
    const map = new Map<string, T>();
    return {
        get(path) {
            return map.get(path);
        },
        set(path, value) {
            map.set(path, value);
        },
        contains(path) {
            return map.has(path);
        },
        remove(path) {
            map.delete(path);
        },
    };
}
/** @internal */
export interface ProjectOptions {
    configHasExtendsProperty: boolean;
    /**
     * true if config file explicitly listed files
     */
    configHasFilesProperty: boolean;
    configHasIncludeProperty: boolean;
    configHasExcludeProperty: boolean;
}
export function isInferredProjectName(name: string): boolean {
    // POSIX defines /dev/null as a device - there should be no file with this prefix
    return /dev\/null\/inferredProject\d+\*/.test(name);
}
export function makeInferredProjectName(counter: number): string {
    return `/dev/null/inferredProject${counter}*`;
}
/** @internal */
export function makeAutoImportProviderProjectName(counter: number): string {
    return `/dev/null/autoImportProviderProject${counter}*`;
}
/** @internal */
export function makeAuxiliaryProjectName(counter: number): string {
    return `/dev/null/auxiliaryProject${counter}*`;
}
export function createSortedArray<T>(): SortedArray<T> {
    return []; // TODO: GH#19873
}
