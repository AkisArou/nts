// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/server/packageJsonCache.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { combinePaths, createPackageJsonInfo, Debug, forEachAncestorDirectoryStoppingAtGlobalCache, getDirectoryPath, type Path, type ProjectPackageJsonInfo, Ternary, tryFileExists } from "./_namespaces/ts.ts";
import { Project, ProjectService } from "./_namespaces/ts.server.ts";
/** @internal */
export interface PackageJsonCache {
    addOrUpdate(fileName: string, path: Path): void;
    invalidate(path: Path): void;
    delete(fileName: Path): void;
    getInDirectory(directory: string): ProjectPackageJsonInfo | undefined;
    directoryHasPackageJson(directory: string): Ternary;
    searchDirectoryAndAncestors(directory: string, project: Project): void;
}
/** @internal */
export function createPackageJsonCache(host: ProjectService): PackageJsonCache {
    const packageJsons = new Map<Path, ProjectPackageJsonInfo>();
    const directoriesWithoutPackageJson = new Map<Path, true>();
    return {
        addOrUpdate,
        invalidate,
        delete: fileName => {
            packageJsons.delete(fileName);
            directoriesWithoutPackageJson.set(getDirectoryPath(fileName), true);
        },
        getInDirectory: directory => {
            return packageJsons.get(host.toPath(combinePaths(directory, "package.json"))) || undefined;
        },
        directoryHasPackageJson: directory => directoryHasPackageJson(host.toPath(directory)),
        searchDirectoryAndAncestors: (directory, project) => {
            forEachAncestorDirectoryStoppingAtGlobalCache(project, directory, ancestor => {
                const ancestorPath = host.toPath(ancestor);
                if (directoryHasPackageJson(ancestorPath) !== Ternary.Maybe) {
                    return true;
                }
                const packageJsonFileName = combinePaths(ancestor, "package.json");
                if (tryFileExists(host, packageJsonFileName)) {
                    addOrUpdate(packageJsonFileName, combinePaths(ancestorPath, "package.json"));
                }
                else {
                    directoriesWithoutPackageJson.set(ancestorPath, true);
                }
            });
        },
    };
    function addOrUpdate(fileName: string, path: Path) {
        const packageJsonInfo = Debug.checkDefined(createPackageJsonInfo(fileName, host.host));
        packageJsons.set(path, packageJsonInfo);
        directoriesWithoutPackageJson.delete(getDirectoryPath(path));
    }
    function invalidate(path: Path) {
        packageJsons.delete(path);
        directoriesWithoutPackageJson.delete(getDirectoryPath(path));
    }
    function directoryHasPackageJson(directory: Path) {
        return packageJsons.has(combinePaths(directory, "package.json")) ? Ternary.True :
            directoriesWithoutPackageJson.has(directory) ? Ternary.False :
                Ternary.Maybe;
    }
}
