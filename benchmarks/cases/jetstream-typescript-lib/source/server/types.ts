// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/server/types.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { type ApplyCodeActionCommandResult, type DirectoryWatcherCallback, type FileWatcher, type FileWatcherCallback, type InstallPackageOptions, type Path, type SortedReadonlyArray, type System, type TypeAcquisition, type WatchOptions } from "./_namespaces/ts.ts";
import { Project, ProjectService } from "./_namespaces/ts.server.ts";
export interface CompressedData {
    length: number;
    compressionKind: string;
    data: unknown;
}
export type ModuleImportResult = {
    module: unknown;
    error: undefined;
} | {
    module: undefined;
    error: unknown;
};
/** @deprecated Use {@link ModuleImportResult} instead. */
export type RequireResult = ModuleImportResult;
export interface ServerHost extends System {
    watchFile(path: string, callback: FileWatcherCallback, pollingInterval?: number, options?: WatchOptions): FileWatcher;
    watchDirectory(path: string, callback: DirectoryWatcherCallback, recursive?: boolean, options?: WatchOptions): FileWatcher;
    preferNonRecursiveWatch?: boolean;
    setTimeout<A extends unknown[]>(callback: (...args: NoInfer<A>) => void, ms: number, ...args: A): unknown;
    clearTimeout(timeoutId: unknown): void;
    setImmediate<A extends unknown[]>(callback: (...args: NoInfer<A>) => void, ...args: A): unknown;
    clearImmediate(timeoutId: unknown): void;
    gc?(): void;
    trace?(s: string): void;
    require?(initialPath: string, moduleName: string): ModuleImportResult;
    /** @internal */
    importPlugin?(root: string, moduleName: string): Promise<ModuleImportResult>;
}
export interface InstallPackageOptionsWithProject extends InstallPackageOptions {
    projectName: string;
    projectRootPath: Path;
}
// for backwards-compatibility
// eslint-disable-next-line @typescript-eslint/naming-convention
export interface ITypingsInstaller {
    isKnownTypesPackageName(name: string): boolean;
    installPackage(options: InstallPackageOptionsWithProject): Promise<ApplyCodeActionCommandResult>;
    enqueueInstallTypingsRequest(p: Project, typeAcquisition: TypeAcquisition, unresolvedImports: SortedReadonlyArray<string> | undefined): void;
    attach(projectService: ProjectService): void;
    onProjectClosed(p: Project): void;
    globalTypingsCacheLocation: string | undefined;
}
