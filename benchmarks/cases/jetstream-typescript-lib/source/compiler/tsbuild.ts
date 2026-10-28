// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/compiler/tsbuild.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { combinePaths, Extension, fileExtensionIs, type Path, type ResolvedConfigFileName } from "./_namespaces/ts.ts";
/** @internal */
export type UpToDateStatusType = number;
/** @internal */
export const UpToDateStatusType: {
    readonly Unbuildable: 0;
    readonly UpToDate: 1;
    readonly UpToDateWithUpstreamTypes: 2;
    readonly OutputMissing: 3;
    readonly ErrorReadingFile: 4;
    readonly OutOfDateWithSelf: 5;
    readonly OutOfDateWithUpstream: 6;
    readonly OutOfDateBuildInfoWithPendingEmit: 7;
    readonly OutOfDateBuildInfoWithErrors: 8;
    readonly OutOfDateOptions: 9;
    readonly OutOfDateRoots: 10;
    readonly UpstreamOutOfDate: 11;
    readonly UpstreamBlocked: 12;
    readonly ComputingUpstream: 13;
    readonly TsVersionOutputOfDate: 14;
    readonly UpToDateWithInputFileText: 15;
    readonly ContainerOnly: 16;
    readonly ForceBuild: 17;
    [index: number]: string;
} = {
    Unbuildable: 0,
    "0": "Unbuildable",
    UpToDate: 1,
    "1": "UpToDate",
    UpToDateWithUpstreamTypes: 2,
    "2": "UpToDateWithUpstreamTypes",
    OutputMissing: 3,
    "3": "OutputMissing",
    ErrorReadingFile: 4,
    "4": "ErrorReadingFile",
    OutOfDateWithSelf: 5,
    "5": "OutOfDateWithSelf",
    OutOfDateWithUpstream: 6,
    "6": "OutOfDateWithUpstream",
    OutOfDateBuildInfoWithPendingEmit: 7,
    "7": "OutOfDateBuildInfoWithPendingEmit",
    OutOfDateBuildInfoWithErrors: 8,
    "8": "OutOfDateBuildInfoWithErrors",
    OutOfDateOptions: 9,
    "9": "OutOfDateOptions",
    OutOfDateRoots: 10,
    "10": "OutOfDateRoots",
    UpstreamOutOfDate: 11,
    "11": "UpstreamOutOfDate",
    UpstreamBlocked: 12,
    "12": "UpstreamBlocked",
    ComputingUpstream: 13,
    "13": "ComputingUpstream",
    TsVersionOutputOfDate: 14,
    "14": "TsVersionOutputOfDate",
    UpToDateWithInputFileText: 15,
    "15": "UpToDateWithInputFileText",
    ContainerOnly: 16,
    "16": "ContainerOnly",
    ForceBuild: 17,
    "17": "ForceBuild"
};
/** @internal */
export type UpToDateStatus = Status.Unbuildable | Status.UpToDate | Status.OutputMissing | Status.ErrorReadingFile | Status.OutOfDateWithSelf | Status.OutOfDateWithUpstream | Status.OutOfDateBuildInfo | Status.OutOfDateRoots | Status.UpstreamOutOfDate | Status.UpstreamBlocked | Status.ComputingUpstream | Status.TsVersionOutOfDate | Status.ContainerOnly | Status.ForceBuild;
/** @internal */
export namespace Status {
    /**
     * The project can't be built at all in its current state. For example,
     * its config file cannot be parsed, or it has a syntax error or missing file
     */
    export interface Unbuildable {
        type: typeof UpToDateStatusType.Unbuildable;
        reason: string;
    }
    /**
     * This project doesn't have any outputs, so "is it up to date" is a meaningless question.
     */
    export interface ContainerOnly {
        type: typeof UpToDateStatusType.ContainerOnly;
    }
    /**
     * The project is up to date with respect to its inputs.
     * We track what the newest input file is.
     */
    export interface UpToDate {
        type: typeof UpToDateStatusType.UpToDate | typeof UpToDateStatusType.UpToDateWithUpstreamTypes | typeof UpToDateStatusType.UpToDateWithInputFileText;
        newestInputFileTime?: Date;
        newestInputFileName?: string;
        oldestOutputFileName: string;
    }
    /**
     * One or more of the outputs of the project does not exist.
     */
    export interface OutputMissing {
        type: typeof UpToDateStatusType.OutputMissing;
        /**
         * The name of the first output file that didn't exist
         */
        missingOutputFileName: string;
    }
    /** Error reading file */
    export interface ErrorReadingFile {
        type: typeof UpToDateStatusType.ErrorReadingFile;
        fileName: string;
    }
    /**
     * One or more of the project's outputs is older than its newest input.
     */
    export interface OutOfDateWithSelf {
        type: typeof UpToDateStatusType.OutOfDateWithSelf;
        outOfDateOutputFileName: string;
        newerInputFileName: string;
    }
    /**
     * Buildinfo indicates that build is out of date
     */
    export interface OutOfDateBuildInfo {
        type: typeof UpToDateStatusType.OutOfDateBuildInfoWithPendingEmit | typeof UpToDateStatusType.OutOfDateBuildInfoWithErrors | typeof UpToDateStatusType.OutOfDateOptions;
        buildInfoFile: string;
    }
    export interface OutOfDateRoots {
        type: typeof UpToDateStatusType.OutOfDateRoots;
        buildInfoFile: string;
        inputFile: Path;
    }
    /**
     * This project depends on an out-of-date project, so shouldn't be built yet
     */
    export interface UpstreamOutOfDate {
        type: typeof UpToDateStatusType.UpstreamOutOfDate;
        upstreamProjectName: string;
    }
    /**
     * This project depends an upstream project with build errors
     */
    export interface UpstreamBlocked {
        type: typeof UpToDateStatusType.UpstreamBlocked;
        upstreamProjectName: string;
        upstreamProjectBlocked: boolean;
    }
    /**
     *  Computing status of upstream projects referenced
     */
    export interface ComputingUpstream {
        type: typeof UpToDateStatusType.ComputingUpstream;
    }
    export interface TsVersionOutOfDate {
        type: typeof UpToDateStatusType.TsVersionOutputOfDate;
        version: unknown;
    }
    /**
     * One or more of the project's outputs is older than the newest output of
     * an upstream project.
     */
    export interface OutOfDateWithUpstream {
        type: typeof UpToDateStatusType.OutOfDateWithUpstream;
        outOfDateOutputFileName: string;
        newerProjectName: string;
    }
    export interface ForceBuild {
        type: typeof UpToDateStatusType.ForceBuild;
    }
}
/** @internal */
export function resolveConfigFileProjectName(project: string): ResolvedConfigFileName {
    if (fileExtensionIs(project, Extension.Json)) {
        return project;
    }
    return combinePaths(project, "tsconfig.json");
}
