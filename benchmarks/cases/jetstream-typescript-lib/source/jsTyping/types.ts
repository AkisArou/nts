// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/jsTyping/types.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { type CompilerOptions, JsTyping, type MapLike, type Path, type SortedReadonlyArray, type TypeAcquisition } from "./_namespaces/ts.ts";
import { ActionInvalidate, ActionPackageInstalled, ActionSet, ActionWatchTypingLocations, EventBeginInstallTypes, EventEndInstallTypes, EventInitializationFailed, EventTypesRegistry } from "./_namespaces/ts.server.ts";
export interface TypingInstallerResponse {
    kind: ActionSet | ActionInvalidate | EventTypesRegistry | ActionPackageInstalled | EventBeginInstallTypes | EventEndInstallTypes | EventInitializationFailed | ActionWatchTypingLocations;
}
export interface TypingInstallerRequestWithProjectName {
    projectName: string;
}
/** @internal */
export type TypingInstallerRequestUnion = DiscoverTypings | CloseProject | TypesRegistryRequest | InstallPackageRequest;
export interface DiscoverTypings extends TypingInstallerRequestWithProjectName {
    fileNames: string[];
    projectRootPath: Path;
    compilerOptions: CompilerOptions;
    typeAcquisition: TypeAcquisition;
    unresolvedImports: SortedReadonlyArray<string>;
    cachePath?: string;
    kind: "discover";
}
export interface CloseProject extends TypingInstallerRequestWithProjectName {
    kind: "closeProject";
}
export interface TypesRegistryRequest {
    kind: "typesRegistry";
}
export interface InstallPackageRequest extends TypingInstallerRequestWithProjectName {
    kind: "installPackage";
    fileName: Path;
    packageName: string;
    projectRootPath: Path;
    id: number;
}
/** @internal */
export interface TypesRegistryResponse extends TypingInstallerResponse {
    kind: EventTypesRegistry;
    typesRegistry: MapLike<MapLike<string>>;
}
export interface PackageInstalledResponse extends ProjectResponse {
    kind: ActionPackageInstalled;
    id: number;
    success: boolean;
    message: string;
}
export interface InitializationFailedResponse extends TypingInstallerResponse {
    kind: EventInitializationFailed;
    message: string;
    stack?: string;
}
export interface ProjectResponse extends TypingInstallerResponse {
    projectName: string;
}
export interface InvalidateCachedTypings extends ProjectResponse {
    kind: ActionInvalidate;
}
export interface InstallTypes extends ProjectResponse {
    kind: EventBeginInstallTypes | EventEndInstallTypes;
    eventId: number;
    typingsInstallerVersion: string;
    packagesToInstall?: readonly string[];
}
export interface BeginInstallTypes extends InstallTypes {
    kind: EventBeginInstallTypes;
}
export interface EndInstallTypes extends InstallTypes {
    kind: EventEndInstallTypes;
    packagesToInstall: readonly string[];
    installSuccess: boolean;
}
export interface InstallTypingHost extends JsTyping.TypingResolutionHost {
    useCaseSensitiveFileNames: boolean;
    writeFile(path: string, content: string): void;
    createDirectory(path: string): void;
    getCurrentDirectory?(): string;
}
export interface SetTypings extends ProjectResponse {
    typeAcquisition: TypeAcquisition;
    compilerOptions: CompilerOptions;
    typings: string[];
    unresolvedImports: SortedReadonlyArray<string>;
    kind: ActionSet;
}
export interface WatchTypingLocations extends ProjectResponse {
    /** if files is undefined, retain same set of watchers */
    files: readonly string[] | undefined;
    kind: ActionWatchTypingLocations;
}
/** @internal */
export type TypingInstallerResponseUnion = SetTypings | InvalidateCachedTypings | TypesRegistryResponse | PackageInstalledResponse | InstallTypes | InitializationFailedResponse | WatchTypingLocations;
