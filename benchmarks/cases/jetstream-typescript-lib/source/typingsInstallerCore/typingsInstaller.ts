// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/typingsInstallerCore/typingsInstaller.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { compilerPropertyObject, stringValue } from "../checked.ts";
import { present } from "../checked.ts";
import { combinePaths, Debug, forEachAncestorDirectory, forEachKey, getBaseFileName, getDirectoryPath, getProperty, hasProperty, JsTyping, mangleScopedPackageName, mapDefined, type MapLike, ModuleResolutionKind, noop, type Path, resolveModuleName, Version, version, versionMajorMinor } from "./_namespaces/ts.ts";
import { ActionPackageInstalled, ActionSet, ActionWatchTypingLocations, type BeginInstallTypes, type CloseProject, type DiscoverTypings, type EndInstallTypes, EventBeginInstallTypes, EventEndInstallTypes, EventTypesRegistry, type InstallPackageRequest, type InstallTypingHost, type InvalidateCachedTypings, type PackageInstalledResponse, type SetTypings, stringifyIndented, type TypesRegistryResponse, type TypingInstallerRequestUnion, type WatchTypingLocations } from "./_namespaces/ts.server.ts";
interface NpmConfig {
    devDependencies: MapLike<unknown>;
}
interface NpmLock {
    dependencies?: {
        [packageName: string]: {
            version: string;
        };
    };
    packages?: {
        [nodeModulesAtTypesPackage: string]: {
            version: string;
        };
    };
}
export interface Log {
    isEnabled(): boolean;
    writeLine(text: string): void;
}
const nullLog: Log = {
    isEnabled: () => false,
    writeLine: noop,
};
function typingToFileName(cachePath: string, packageName: string, installTypingHost: InstallTypingHost, log: Log): string | undefined {
    try {
        const result = resolveModuleName(packageName, combinePaths(cachePath, "index.d.ts"), { moduleResolution: ModuleResolutionKind.Node10 }, installTypingHost);
        return result.resolvedModule && result.resolvedModule.resolvedFileName;
    }
    catch (e) {
        if (log.isEnabled()) {
            log.writeLine(`Failed to resolve ${packageName} in folder '${cachePath}': ${compilerPropertyObject((e)).message}`);
        }
        return undefined;
    }
}
/** @internal */
export function installNpmPackages(npmPath: string, tsVersion: string, packageNames: string[], install: (command: string) => boolean): boolean {
    let hasError = false;
    for (let remaining = packageNames.length; remaining > 0;) {
        const result = getNpmCommandForInstallation(npmPath, tsVersion, packageNames, remaining);
        remaining = result.remaining;
        hasError = install(result.command) || hasError;
    }
    return hasError;
}
/** @internal */
export function getNpmCommandForInstallation(npmPath: string, tsVersion: string, packageNames: string[], remaining: number): {
    command: string;
    remaining: number;
} {
    const sliceStart = packageNames.length - remaining;
    let command: string, toSlice = remaining;
    while (true) {
        command = `${npmPath} install --ignore-scripts ${(toSlice === packageNames.length ? packageNames : packageNames.slice(sliceStart, sliceStart + toSlice)).join(" ")} --save-dev --user-agent="typesInstaller/${tsVersion}"`;
        if (command.length < 8000) {
            break;
        }
        toSlice = toSlice - Math.floor(toSlice / 2);
    }
    return { command, remaining: remaining - toSlice };
}
export type RequestCompletedAction = (success: boolean) => void;
export interface PendingRequest {
    requestId: number;
    packageNames: string[];
    cwd: string;
    onRequestCompleted: RequestCompletedAction;
}
export abstract class TypingsInstaller {
    constructor(installTypingHost: InstallTypingHost, globalCachePath: string, safeListPath: Path, typesMapLocation: Path, throttleLimit: number, log: Log = nullLog) {
        this.installTypingHost = installTypingHost;
        this.globalCachePath = globalCachePath;
        this.safeListPath = safeListPath;
        this.typesMapLocation = typesMapLocation;
        this.throttleLimit = throttleLimit;
        this.log = log;
        this.packageNameToTypingLocation = new Map<string, JsTyping.CachedTyping>();
        this.missingTypingsSet = new Set<string>();
        this.knownCachesSet = new Set<string>();
        this.projectWatchers = new Map<string, Set<string>>();
        this.pendingRunRequests = [];
        this.installRunCount = 1;
        this.inFlightRequestCount = 0;
        this.latestDistTag = "latest";
        const isLoggingEnabled = this.log.isEnabled();
        if (isLoggingEnabled) {
            this.log.writeLine(`Global cache location '${globalCachePath}', safe file path '${safeListPath}', types map path ${typesMapLocation}`);
        }
        this.processCacheLocation(this.globalCachePath);
    }
    declare private packageNameToTypingLocation: Map<string, JsTyping.CachedTyping>;
    declare private missingTypingsSet: Set<string>;
    declare private knownCachesSet: Set<string>;
    declare private projectWatchers: Map<string, Set<string>>;
    declare private safeList: JsTyping.SafeList | undefined;
    declare private pendingRunRequests: PendingRequest[];
    declare private installRunCount: number;
    declare private inFlightRequestCount: number;
    declare abstract typesRegistry: Map<string, MapLike<string>>;
    /** @internal */
    handleRequest(req: TypingInstallerRequestUnion): void {
        switch (req.kind) {
            case "discover":
                this.install(req);
                break;
            case "closeProject":
                this.closeProject(req);
                break;
            case "typesRegistry": {
                const typesRegistry: {
                    [key: string]: MapLike<string>;
                } = {};
                this.typesRegistry.forEach((value, key) => {
                    typesRegistry[key] = value;
                });
                const response: TypesRegistryResponse = { kind: EventTypesRegistry, typesRegistry };
                this.sendResponse(response);
                break;
            }
            case "installPackage": {
                this.installPackage(req);
                break;
            }
            default:
                Debug.assertNever(req);
        }
    }
    closeProject(req: CloseProject): void {
        this.closeWatchers(req.projectName);
    }
    private closeWatchers(projectName: string): void {
        if (this.log.isEnabled()) {
            this.log.writeLine(`Closing file watchers for project '${projectName}'`);
        }
        const watchers = this.projectWatchers.get(projectName);
        if (!watchers) {
            if (this.log.isEnabled()) {
                this.log.writeLine(`No watchers are registered for project '${projectName}'`);
            }
            return;
        }
        // Close all the watchers
        this.projectWatchers.delete(projectName);
        this.sendResponse({ kind: ActionWatchTypingLocations, projectName, files: [] });
        if (this.log.isEnabled()) {
            this.log.writeLine(`Closing file watchers for project '${projectName}' - done.`);
        }
    }
    install(req: DiscoverTypings): void {
        if (this.log.isEnabled()) {
            this.log.writeLine(`Got install request${stringifyIndented(req)}`);
        }
        // load existing typing information from the cache
        if (req.cachePath) {
            if (this.log.isEnabled()) {
                this.log.writeLine(`Request specifies cache path '${req.cachePath}', loading cached information...`);
            }
            this.processCacheLocation(req.cachePath);
        }
        if (this.safeList === undefined) {
            this.initializeSafeList();
        }
        const discoverTypingsResult = JsTyping.discoverTypings(this.installTypingHost, this.log.isEnabled() ? (s => this.log.writeLine(s)) : undefined, req.fileNames, req.projectRootPath, (this.safeList)!, this.packageNameToTypingLocation, req.typeAcquisition, req.unresolvedImports, this.typesRegistry, req.compilerOptions);
        // start watching files
        this.watchFiles(req.projectName, discoverTypingsResult.filesToWatch);
        // install typings
        if (discoverTypingsResult.newTypingNames.length) {
            this.installTypings(req, req.cachePath || this.globalCachePath, discoverTypingsResult.cachedTypingPaths, discoverTypingsResult.newTypingNames);
        }
        else {
            this.sendResponse(this.createSetTypings(req, discoverTypingsResult.cachedTypingPaths));
            if (this.log.isEnabled()) {
                this.log.writeLine(`No new typings were requested as a result of typings discovery`);
            }
        }
    }
    /** @internal */
    installPackage(req: InstallPackageRequest): void {
        const { fileName, packageName, projectName, projectRootPath, id } = req;
        const cwd = forEachAncestorDirectory(getDirectoryPath(fileName), directory => {
            if (this.installTypingHost.fileExists(combinePaths(directory, "package.json"))) {
                return directory;
            }
        }) || projectRootPath;
        if (cwd) {
            this.installWorker(-1, [packageName], cwd, success => {
                const message = success ?
                    `Package ${packageName} installed.` :
                    `There was an error installing ${packageName}.`;
                const response: PackageInstalledResponse = {
                    kind: ActionPackageInstalled,
                    projectName,
                    id,
                    success,
                    message,
                };
                this.sendResponse(response);
            });
        }
        else {
            const response: PackageInstalledResponse = {
                kind: ActionPackageInstalled,
                projectName,
                id,
                success: false,
                message: "Could not determine a project root path.",
            };
            this.sendResponse(response);
        }
    }
    private initializeSafeList() {
        // Prefer the safe list from the types map if it exists
        if (this.typesMapLocation) {
            const safeListFromMap = JsTyping.loadTypesMap(this.installTypingHost, this.typesMapLocation);
            if (safeListFromMap) {
                this.log.writeLine(`Loaded safelist from types map file '${this.typesMapLocation}'`);
                this.safeList = safeListFromMap;
                return;
            }
            this.log.writeLine(`Failed to load safelist from types map file '${this.typesMapLocation}'`);
        }
        this.safeList = JsTyping.loadSafeList(this.installTypingHost, this.safeListPath);
    }
    private processCacheLocation(cacheLocation: string) {
        if (this.log.isEnabled()) {
            this.log.writeLine(`Processing cache location '${cacheLocation}'`);
        }
        if (this.knownCachesSet.has(cacheLocation)) {
            if (this.log.isEnabled()) {
                this.log.writeLine(`Cache location was already processed...`);
            }
            return;
        }
        const packageJson = combinePaths(cacheLocation, "package.json");
        const packageLockJson = combinePaths(cacheLocation, "package-lock.json");
        if (this.log.isEnabled()) {
            this.log.writeLine(`Trying to find '${packageJson}'...`);
        }
        if (this.installTypingHost.fileExists(packageJson) && this.installTypingHost.fileExists(packageLockJson)) {
            const npmConfig: unknown = JSON.parse((this.installTypingHost.readFile(packageJson))!); // TODO: GH#18217
            const npmLock: unknown = JSON.parse((this.installTypingHost.readFile(packageLockJson))!); // TODO: GH#18217
            if (this.log.isEnabled()) {
                this.log.writeLine(`Loaded content of '${packageJson}':${stringifyIndented(npmConfig)}`);
                this.log.writeLine(`Loaded content of '${packageLockJson}':${stringifyIndented(npmLock)}`);
            }
            // Packages is present in lock file 3 vs lockfile 2 has dependencies field for already installed types package
            if (compilerPropertyObject(npmConfig).devDependencies && (compilerPropertyObject(npmLock).packages || compilerPropertyObject(npmLock).dependencies)) {
                for (const key in compilerPropertyObject(compilerPropertyObject(npmConfig).devDependencies)) {
                    if ((compilerPropertyObject(npmLock).packages && !hasProperty(compilerPropertyObject(npmLock).packages, `node_modules/${key}`)) ||
                        (compilerPropertyObject(npmLock).dependencies && !hasProperty(compilerPropertyObject(npmLock).dependencies, key))) {
                        // if package in package.json but not package-lock.json, skip adding to cache so it is reinstalled on next use
                        continue;
                    }
                    // key is @types/<package name>
                    const packageName = getBaseFileName(key);
                    if (!packageName) {
                        continue;
                    }
                    const typingFile = typingToFileName(cacheLocation, packageName, this.installTypingHost, this.log);
                    if (!typingFile) {
                        this.missingTypingsSet.add(packageName);
                        continue;
                    }
                    const existingTypingFile = this.packageNameToTypingLocation.get(packageName);
                    if (existingTypingFile) {
                        if (existingTypingFile.typingLocation === typingFile) {
                            continue;
                        }
                        if (this.log.isEnabled()) {
                            this.log.writeLine(`New typing for package ${packageName} from '${typingFile}' conflicts with existing typing file '${existingTypingFile}'`);
                        }
                    }
                    if (this.log.isEnabled()) {
                        this.log.writeLine(`Adding entry into typings cache: '${packageName}' => '${typingFile}'`);
                    }
                    const info = compilerPropertyObject(npmLock).packages && getProperty(compilerPropertyObject(compilerPropertyObject(npmLock).packages), `node_modules/${key}`) ||
                        getProperty(compilerPropertyObject(compilerPropertyObject(npmLock).dependencies), key);
                    const version = info && compilerPropertyObject(info).version;
                    if (!version) {
                        continue;
                    }
                    const newTyping: JsTyping.CachedTyping = { typingLocation: typingFile, version: new Version(version) };
                    this.packageNameToTypingLocation.set(packageName, newTyping);
                }
            }
        }
        if (this.log.isEnabled()) {
            this.log.writeLine(`Finished processing cache location '${cacheLocation}'`);
        }
        this.knownCachesSet.add(cacheLocation);
    }
    private filterTypings(typingsToInstall: readonly unknown[]): readonly string[] {
        return mapDefined(typingsToInstall, rawTyping => {
            const typing = stringValue(rawTyping);
            const typingKey = mangleScopedPackageName(typing);
            if (this.missingTypingsSet.has(typingKey)) {
                if (this.log.isEnabled())
                    this.log.writeLine(`'${typing}':: '${typingKey}' is in missingTypingsSet - skipping...`);
                return undefined;
            }
            const validationResult = JsTyping.validatePackageName(typing);
            if (validationResult !== JsTyping.NameValidationResult.Ok) {
                // add typing name to missing set so we won't process it again
                this.missingTypingsSet.add(typingKey);
                if (this.log.isEnabled())
                    this.log.writeLine(JsTyping.renderPackageNameValidationFailure(validationResult, typing));
                return undefined;
            }
            if (!this.typesRegistry.has(typingKey)) {
                if (this.log.isEnabled())
                    this.log.writeLine(`'${typing}':: Entry for package '${typingKey}' does not exist in local types registry - skipping...`);
                return undefined;
            }
            if (this.packageNameToTypingLocation.get(typingKey) && JsTyping.isTypingUpToDate((this.packageNameToTypingLocation.get(typingKey))!, (this.typesRegistry.get(typingKey))!)) {
                if (this.log.isEnabled())
                    this.log.writeLine(`'${typing}':: '${typingKey}' already has an up-to-date typing - skipping...`);
                return undefined;
            }
            return typingKey;
        });
    }
    protected ensurePackageDirectoryExists(directory: string): void {
        const npmConfigPath = combinePaths(directory, "package.json");
        if (this.log.isEnabled()) {
            this.log.writeLine(`Npm config file: ${npmConfigPath}`);
        }
        if (!this.installTypingHost.fileExists(npmConfigPath)) {
            if (this.log.isEnabled()) {
                this.log.writeLine(`Npm config file: '${npmConfigPath}' is missing, creating new one...`);
            }
            this.ensureDirectoryExists(directory, this.installTypingHost);
            this.installTypingHost.writeFile(npmConfigPath, '{ "private": true }');
        }
    }
    private installTypings(req: DiscoverTypings, cachePath: string, currentlyCachedTypings: string[], typingsToInstall: unknown[]) {
        if (this.log.isEnabled()) {
            this.log.writeLine(`Installing typings ${JSON.stringify(typingsToInstall)}`);
        }
        const filteredTypings = this.filterTypings(typingsToInstall);
        if (filteredTypings.length === 0) {
            if (this.log.isEnabled()) {
                this.log.writeLine(`All typings are known to be missing or invalid - no need to install more typings`);
            }
            this.sendResponse(this.createSetTypings(req, currentlyCachedTypings));
            return;
        }
        this.ensurePackageDirectoryExists(cachePath);
        const requestId = this.installRunCount;
        this.installRunCount++;
        // send progress event
        this.sendResponse({
            kind: EventBeginInstallTypes,
            eventId: requestId,
            typingsInstallerVersion: version,
            projectName: req.projectName,
        });
        const scopedTypings = filteredTypings.map(typingsName);
        this.installTypingsAsync(requestId, scopedTypings, cachePath, ok => {
            try {
                if (!ok) {
                    if (this.log.isEnabled()) {
                        this.log.writeLine(`install request failed, marking packages as missing to prevent repeated requests: ${JSON.stringify(filteredTypings)}`);
                    }
                    for (const typing of filteredTypings) {
                        this.missingTypingsSet.add(typing);
                    }
                    return;
                }
                // TODO: watch project directory
                if (this.log.isEnabled()) {
                    this.log.writeLine(`Installed typings ${JSON.stringify(scopedTypings)}`);
                }
                const installedTypingFiles: string[] = [];
                for (const packageName of filteredTypings) {
                    const typingFile = typingToFileName(cachePath, packageName, this.installTypingHost, this.log);
                    if (!typingFile) {
                        this.missingTypingsSet.add(packageName);
                        continue;
                    }
                    // packageName is guaranteed to exist in typesRegistry by filterTypings
                    const distTags = this.typesRegistry.get(packageName);
                    const newVersion = new Version((distTags)![`ts${versionMajorMinor}`] || (distTags)![this.latestDistTag]);
                    const newTyping: JsTyping.CachedTyping = { typingLocation: typingFile, version: newVersion };
                    this.packageNameToTypingLocation.set(packageName, newTyping);
                    installedTypingFiles.push(typingFile);
                }
                if (this.log.isEnabled()) {
                    this.log.writeLine(`Installed typing files ${JSON.stringify(installedTypingFiles)}`);
                }
                this.sendResponse(this.createSetTypings(req, currentlyCachedTypings.concat(installedTypingFiles)));
            }
            finally {
                const response: EndInstallTypes = {
                    kind: EventEndInstallTypes,
                    eventId: requestId,
                    projectName: req.projectName,
                    packagesToInstall: scopedTypings,
                    installSuccess: ok,
                    typingsInstallerVersion: version,
                };
                this.sendResponse(response);
            }
        });
    }
    private ensureDirectoryExists(directory: string, host: InstallTypingHost): void {
        const directoryName = getDirectoryPath(directory);
        if (!host.directoryExists(directoryName)) {
            this.ensureDirectoryExists(directoryName, host);
        }
        if (!host.directoryExists(directory)) {
            host.createDirectory(directory);
        }
    }
    private watchFiles(projectName: string, files: string[]) {
        if (!files.length) {
            // shut down existing watchers
            this.closeWatchers(projectName);
            return;
        }
        const existing = this.projectWatchers.get(projectName);
        const newSet = new Set(files);
        if (!existing || forEachKey(newSet, s => !existing.has(s)) || forEachKey(existing, s => !newSet.has(s))) {
            this.projectWatchers.set(projectName, newSet);
            this.sendResponse({ kind: ActionWatchTypingLocations, projectName, files });
        }
        else {
            // Keep same list of files
            this.sendResponse({ kind: ActionWatchTypingLocations, projectName, files: undefined });
        }
    }
    private createSetTypings(request: DiscoverTypings, typings: string[]): SetTypings {
        return {
            projectName: request.projectName,
            typeAcquisition: request.typeAcquisition,
            compilerOptions: request.compilerOptions,
            typings,
            unresolvedImports: request.unresolvedImports,
            kind: ActionSet,
        };
    }
    private installTypingsAsync(requestId: number, packageNames: string[], cwd: string, onRequestCompleted: RequestCompletedAction): void {
        this.pendingRunRequests.unshift({ requestId, packageNames, cwd, onRequestCompleted });
        this.executeWithThrottling();
    }
    private executeWithThrottling() {
        while (this.inFlightRequestCount < this.throttleLimit && this.pendingRunRequests.length) {
            this.inFlightRequestCount++;
            const request = this.pendingRunRequests.pop();
            this.installWorker((request)!.requestId, (request)!.packageNames, (request)!.cwd, ok => {
                this.inFlightRequestCount--;
                (request)!.onRequestCompleted(ok);
                this.executeWithThrottling();
            });
        }
    }
    protected abstract installWorker(requestId: number, packageNames: string[], cwd: string, onRequestCompleted: RequestCompletedAction): void;
    protected abstract sendResponse(response: SetTypings | InvalidateCachedTypings | BeginInstallTypes | EndInstallTypes | WatchTypingLocations): void;
    /** @internal */
    protected abstract sendResponse(response: SetTypings | InvalidateCachedTypings | BeginInstallTypes | EndInstallTypes | WatchTypingLocations | PackageInstalledResponse | TypesRegistryResponse): void; // eslint-disable-line @typescript-eslint/unified-signatures
    declare protected latestDistTag: string;
    declare protected installTypingHost: InstallTypingHost;
    declare private globalCachePath: string;
    declare private safeListPath: Path;
    declare private typesMapLocation: Path;
    declare private throttleLimit: number;
    declare protected log: Log;
}
/** @internal */
export function typingsName(packageName: string): string {
    return `@types/${packageName}@ts${versionMajorMinor}`;
}
