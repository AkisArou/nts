// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/compiler/tracing.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
// JetStream webpack module 21 (the fs browser replacement) has an empty body
// and exposes the same empty exports object to tracing's dormant loader.
interface TracingFileSystem {
    existsSync(path: string): boolean;
    mkdirSync(path: string, options: {
        recursive: true;
    }): string | undefined;
    openSync(path: string, flags: "w"): number;
    writeSync(fd: number, text: string): number;
    closeSync(fd: number): void;
    writeFileSync(path: string, text: string): void;
}
interface TraceableType extends Type {
    objectFlags?: ObjectFlags;
    intrinsicName?: string;
}
const tracingFileSystemModule: Partial<TracingFileSystem> = {};
declare const process: {
    pid: number;
};
import { compilerPropertyObject } from "../checked.ts";
interface NamespaceLayout_tracingEnabled {
    startTracing: {
        (tracingMode: tracingEnabled.Mode, traceDir: string, configFilePath?: string): void;
    };
    stopTracing: {
        (): void;
    };
    recordType: {
        (type: Type): void;
    };
    instant: {
        (phase: tracingEnabled.Phase, name: string, args?: tracingEnabled.Args): void;
    };
    push: {
        (phase: tracingEnabled.Phase, name: string, args?: tracingEnabled.Args, separateBeginAndEnd?: boolean): void;
    };
    pop: {
        (results?: tracingEnabled.Args): void;
    };
    popAll: {
        (): void;
    };
    dumpLegend: {
        (): void;
    };
    Phase: {
        readonly Parse: "parse";
        readonly Program: "program";
        readonly Bind: "bind";
        readonly Check: "check";
        readonly CheckTypes: "checkTypes";
        readonly Emit: "emit";
        readonly Session: "session";
    };
}
export declare namespace tracingEnabled {
    export type Mode = "project" | "build" | "server";
    // The actual constraint is that JSON.stringify be able to serialize it without throwing.
    export interface Args {
        [key: string]: string | number | boolean | null | undefined | Args | readonly (string | number | boolean | null | undefined | Args)[]; // eslint-disable-line no-restricted-syntax
    }
    export type Phase = "parse" | "program" | "bind" | "check" | "checkTypes" | "emit" | "session";
    export interface TraceRecord {
        configFilePath?: string;
        tracePath: string;
        typesPath?: (string) | undefined;
    }
}
import { checkedCompilerLayout, present } from "../checked.ts";
import { isCompilerIndexedAccessType as checked_isCompilerIndexedAccessType } from "../checkedTypes.ts";
import { isCompilerTypeReference as checked_isCompilerTypeReference } from "../checkedTypes.ts";
import { isCompilerConditionalType as checked_isCompilerConditionalType } from "../checkedTypes.ts";
import { isCompilerSubstitutionType as checked_isCompilerSubstitutionType } from "../checkedTypes.ts";
import { isCompilerReverseMappedType as checked_isCompilerReverseMappedType } from "../checkedTypes.ts";
import { isCompilerEvolvingArrayType as checked_isCompilerEvolvingArrayType } from "../checkedTypes.ts";
import { isCompilerUnionType as checked_isCompilerUnionType } from "../checkedTypes.ts";
import { isCompilerIntersectionType as checked_isCompilerIntersectionType } from "../checkedTypes.ts";
import { isCompilerIndexType as checked_isCompilerIndexType } from "../checkedTypes.ts";
import { combinePaths, type ConditionalType, Debug, type EvolvingArrayType, getLineAndCharacterOfPosition, getSourceFileOfNode, type IndexedAccessType, type IndexType, type IntersectionType, type LineAndCharacter, type Node, ObjectFlags, type Path, type ReverseMappedType, type SubstitutionType, timestamp, type Type, TypeFlags, type TypeReference, unescapeLeadingUnderscores, type UnionType } from "./_namespaces/ts.ts";
import * as performance from "./_namespaces/ts.performance.ts";
/* Tracing events for the compiler. */
// should be used as tracing?.___
/** @internal */
export let tracing: typeof tracingEnabled | undefined;
export const tracingEnabled: NamespaceLayout_tracingEnabled = (function (): NamespaceLayout_tracingEnabled {
    type Mode = "project" | "build" | "server";
    let fs: Partial<TracingFileSystem> | undefined;
    let traceCount = 0;
    let traceFd = 0;
    let mode: Mode;
    const typeCatalog: Type[] = []; // NB: id is index + 1
    let legendPath: string | undefined;
    const legend: TraceRecord[] = [];
    // The actual constraint is that JSON.stringify be able to serialize it without throwing.
    interface Args {
        [key: string]: string | number | boolean | null | undefined | Args | readonly (string | number | boolean | null | undefined | Args)[]; // eslint-disable-line no-restricted-syntax
    }
    /** Starts tracing for the given project. */
    function startTracing(tracingMode: Mode, traceDir: string, configFilePath?: string): void {
        Debug.assert(!tracing, "Tracing already started");
        if (fs === undefined) {
            try {
                fs = tracingFileSystemModule;
            }
            catch (e) {
                throw new Error(`tracing requires having fs\n(original error: ${compilerPropertyObject(e).message || e})`);
            }
        }
        mode = tracingMode;
        typeCatalog.length = 0;
        if (legendPath === undefined) {
            legendPath = combinePaths(traceDir, "legend.json");
        }
        // Note that writing will fail later on if it exists and is not a directory
        if (!fs!.existsSync!(traceDir)) {
            fs!.mkdirSync!(traceDir, { recursive: true });
        }
        const countPart = mode === "build" ? `.${process.pid}-${++traceCount}`
            : mode === "server" ? `.${process.pid}`
                : ``;
        const tracePath = combinePaths(traceDir, `trace${countPart}.json`);
        const typesPath = combinePaths(traceDir, `types${countPart}.json`);
        legend.push({
            configFilePath,
            tracePath,
            typesPath,
        });
        traceFd = fs!.openSync!(tracePath, "w");
        tracing = tracingEnabled; // only when traceFd is properly set
        // Start with a prefix that contains some metadata that the devtools profiler expects (also avoids a warning on import)
        const meta = { cat: "__metadata", ph: "M", ts: 1000 * timestamp(), pid: 1, tid: 1 };
        fs!.writeSync!(traceFd, "[\n"
            + [{ name: "process_name", args: { name: "tsc" }, ...meta }, { name: "thread_name", args: { name: "Main" }, ...meta }, { name: "TracingStartedInBrowser", ...meta, cat: "disabled-by-default-devtools.timeline" }]
                .map(v => JSON.stringify(v)).join(",\n"));
    }
    /** Stops tracing for the in-progress project and dumps the type catalog. */
    function stopTracing(): void {
        Debug.assert(tracing, "Tracing is not in progress");
        Debug.assert(!!typeCatalog.length === (mode !== "server")); // Have a type catalog iff not in server mode
        fs!.writeSync!(traceFd, `\n]\n`);
        fs!.closeSync!(traceFd);
        tracing = undefined;
        if (typeCatalog.length) {
            dumpTypes(typeCatalog);
        }
        else {
            // We pre-computed this path for convenience, but clear it
            // now that the file won't be created.
            legend[legend.length - 1].typesPath = undefined;
        }
    }
    function recordType(type: Type): void {
        if (mode !== "server") {
            typeCatalog.push(type);
        }
    }
    type Phase = "parse" | "program" | "bind" | "check" | "checkTypes" | "emit" | "session";
    const Phase: {
        readonly Parse: "parse";
        readonly Program: "program";
        readonly Bind: "bind";
        readonly Check: "check";
        readonly CheckTypes: "checkTypes";
        readonly Emit: "emit";
        readonly Session: "session";
    } = {
        Parse: "parse",
        Program: "program",
        Bind: "bind",
        Check: "check",
        CheckTypes: "checkTypes",
        Emit: "emit",
        Session: "session"
    };
    function instant(phase: tracingEnabled.Phase, name: string, args?: Args): void {
        writeEvent("I", phase, name, args, `"s":"g"`);
    }
    const eventStack: {
        phase: Phase;
        name: string;
        args?: Args;
        time: number;
        separateBeginAndEnd: boolean;
    }[] = [];
    /**
     * @param separateBeginAndEnd - used for special cases where we need the trace point even if the event
     * never terminates (typically for reducing a scenario too big to trace to one that can be completed).
     * In the future we might implement an exit handler to dump unfinished events which would deprecate
     * these operations.
     */
    function push(phase: tracingEnabled.Phase, name: string, args?: Args, separateBeginAndEnd = false): void {
        if (separateBeginAndEnd) {
            writeEvent("B", phase, name, args);
        }
        eventStack.push({ phase, name, args, time: 1000 * timestamp(), separateBeginAndEnd });
    }
    function pop(results?: Args): void {
        Debug.assert(eventStack.length > 0);
        writeStackEvent(eventStack.length - 1, 1000 * timestamp(), results);
        eventStack.length--;
    }
    function popAll(): void {
        const endTime = 1000 * timestamp();
        for (let i = eventStack.length - 1; i >= 0; i--) {
            writeStackEvent(i, endTime);
        }
        eventStack.length = 0;
    }
    // sample every 10ms
    const sampleInterval = 1000 * 10;
    function writeStackEvent(index: number, endTime: number, results?: Args) {
        const { phase, name, args, time, separateBeginAndEnd } = eventStack[index];
        if (separateBeginAndEnd) {
            Debug.assert(!results, "`results` are not supported for events with `separateBeginAndEnd`");
            writeEvent("E", phase, name, args, /*extras*/ undefined, endTime);
        }
        // test if [time,endTime) straddles a sampling point
        else if (sampleInterval - (time % sampleInterval) <= endTime - time) {
            writeEvent("X", phase, name, { ...args, results }, `"dur":${endTime - time}`, time);
        }
    }
    function writeEvent(eventType: string, phase: tracingEnabled.Phase, name: string, args: Args | undefined, extras?: string, time: number = 1000 * timestamp()) {
        // In server mode, there's no easy way to dump type information, so we drop events that would require it.
        if (mode === "server" && phase === tracingEnabled.Phase.CheckTypes)
            return;
        performance.mark("beginTracing");
        fs!.writeSync!(traceFd, `,\n{"pid":1,"tid":1,"ph":"${eventType}","cat":"${phase}","ts":${time},"name":"${name}"`);
        if (extras)
            fs!.writeSync!(traceFd, `,${extras}`);
        if (args)
            fs!.writeSync!(traceFd, `,"args":${JSON.stringify(args)}`);
        fs!.writeSync!(traceFd, `}`);
        performance.mark("endTracing");
        performance.measure("Tracing", "beginTracing", "endTracing");
    }
    function getLocation(node: Node | undefined) {
        const file = getSourceFileOfNode(node);
        return !file
            ? undefined
            : {
                path: file.path,
                start: indexFromOne(getLineAndCharacterOfPosition(file, (node)!.pos)),
                end: indexFromOne(getLineAndCharacterOfPosition(file, (node)!.end)),
            };
        function indexFromOne(lc: LineAndCharacter): LineAndCharacter {
            return {
                line: lc.line + 1,
                character: lc.character + 1,
            };
        }
    }
    function dumpTypes(types: readonly Type[]) {
        performance.mark("beginDumpTypes");
        const typesPath = legend[legend.length - 1].typesPath;
        const typesFd = fs!.openSync!(typesPath!, "w");
        const recursionIdentityMap = new Map<object, number>();
        // Cleverness: no line break here so that the type ID will match the line number
        fs!.writeSync!(typesFd, "[");
        const numTypes = types.length;
        for (let i = 0; i < numTypes; i++) {
            const type: TraceableType = types[i];
            const objectFlags = (type).objectFlags!;
            const symbol = type.aliasSymbol ?? type.symbol;
            // It's slow to compute the display text, so skip it unless it's really valuable (or cheap)
            let display: string | undefined;
            if ((objectFlags & ObjectFlags.Anonymous) | (type.flags & TypeFlags.Literal)) {
                try {
                    display = type.checker?.typeToString(type);
                }
                catch {
                    display = undefined;
                }
            }
            let indexedAccessProperties: object = {};
            if (type.flags & TypeFlags.IndexedAccess) {
                const indexedAccessType = checkedCompilerLayout(type, checked_isCompilerIndexedAccessType);
                indexedAccessProperties = {
                    indexedAccessObjectType: indexedAccessType.objectType?.id,
                    indexedAccessIndexType: indexedAccessType.indexType?.id,
                };
            }
            let referenceProperties: object = {};
            if (objectFlags & ObjectFlags.Reference) {
                const referenceType = checkedCompilerLayout(type, checked_isCompilerTypeReference);
                referenceProperties = {
                    instantiatedType: referenceType.target?.id,
                    typeArguments: referenceType.resolvedTypeArguments?.map(t => t.id),
                    referenceLocation: getLocation(referenceType.node),
                };
            }
            let conditionalProperties: object = {};
            if (type.flags & TypeFlags.Conditional) {
                const conditionalType = checkedCompilerLayout(type, checked_isCompilerConditionalType);
                conditionalProperties = {
                    conditionalCheckType: conditionalType.checkType?.id,
                    conditionalExtendsType: conditionalType.extendsType?.id,
                    conditionalTrueType: conditionalType.resolvedTrueType?.id ?? -1,
                    conditionalFalseType: conditionalType.resolvedFalseType?.id ?? -1,
                };
            }
            let substitutionProperties: object = {};
            if (type.flags & TypeFlags.Substitution) {
                const substitutionType = checkedCompilerLayout(type, checked_isCompilerSubstitutionType);
                substitutionProperties = {
                    substitutionBaseType: substitutionType.baseType?.id,
                    constraintType: substitutionType.constraint?.id,
                };
            }
            let reverseMappedProperties: object = {};
            if (objectFlags & ObjectFlags.ReverseMapped) {
                const reverseMappedType = checkedCompilerLayout(type, checked_isCompilerReverseMappedType);
                reverseMappedProperties = {
                    reverseMappedSourceType: reverseMappedType.source?.id,
                    reverseMappedMappedType: reverseMappedType.mappedType?.id,
                    reverseMappedConstraintType: reverseMappedType.constraintType?.id,
                };
            }
            let evolvingArrayProperties: object = {};
            if (objectFlags & ObjectFlags.EvolvingArray) {
                const evolvingArrayType = checkedCompilerLayout(type, checked_isCompilerEvolvingArrayType);
                evolvingArrayProperties = {
                    evolvingArrayElementType: evolvingArrayType.elementType.id,
                    evolvingArrayFinalType: evolvingArrayType.finalArrayType?.id,
                };
            }
            // We can't print out an arbitrary object, so just assign each one a unique number.
            // Don't call it an "id" so people don't treat it as a type id.
            let recursionToken: number | undefined;
            const recursionIdentity = (type.checker)!.getRecursionIdentity(type);
            if (recursionIdentity) {
                recursionToken = recursionIdentityMap.get(recursionIdentity);
                if (!recursionToken) {
                    recursionToken = recursionIdentityMap.size;
                    recursionIdentityMap.set(recursionIdentity, recursionToken);
                }
            }
            const descriptor = {
                id: type.id,
                intrinsicName: (type).intrinsicName,
                symbolName: symbol?.escapedName && unescapeLeadingUnderscores(symbol.escapedName),
                recursionId: recursionToken,
                isTuple: objectFlags & ObjectFlags.Tuple ? true : undefined,
                unionTypes: (type.flags & TypeFlags.Union) ? (checkedCompilerLayout(type, checked_isCompilerUnionType)).types?.map(t => t.id) : undefined,
                intersectionTypes: (type.flags & TypeFlags.Intersection) ? (checkedCompilerLayout(type, checked_isCompilerIntersectionType)).types.map(t => t.id) : undefined,
                aliasTypeArguments: type.aliasTypeArguments?.map(t => t.id),
                keyofType: (type.flags & TypeFlags.Index) ? (checkedCompilerLayout(type, checked_isCompilerIndexType)).type?.id : undefined,
                ...indexedAccessProperties,
                ...referenceProperties,
                ...conditionalProperties,
                ...substitutionProperties,
                ...reverseMappedProperties,
                ...evolvingArrayProperties,
                destructuringPattern: getLocation(type.pattern),
                firstDeclaration: getLocation(symbol?.declarations?.[0]),
                flags: Debug.formatTypeFlags(type.flags).split("|"),
                display,
            };
            fs!.writeSync!(typesFd, JSON.stringify(descriptor));
            if (i < numTypes - 1) {
                fs!.writeSync!(typesFd, ",\n");
            }
        }
        fs!.writeSync!(typesFd, "]\n");
        fs!.closeSync!(typesFd);
        performance.mark("endDumpTypes");
        performance.measure("Dump types", "beginDumpTypes", "endDumpTypes");
    }
    function dumpLegend(): void {
        if (!legendPath) {
            return;
        }
        fs!.writeFileSync!(legendPath, JSON.stringify(legend));
    }
    interface TraceRecord {
        configFilePath?: string;
        tracePath: string;
        typesPath?: (string) | undefined;
    }
    return {
        startTracing,
        stopTracing,
        recordType,
        Phase,
        instant,
        push,
        pop,
        popAll,
        dumpLegend
    };
})();
// define after tracingEnabled is initialized
/** @internal */
export const startTracing: typeof tracingEnabled.startTracing = tracingEnabled.startTracing;
/** @internal */
export const dumpTracingLegend: typeof tracingEnabled.dumpLegend = tracingEnabled.dumpLegend;
/** @internal */
export interface TracingNode {
    tracingPath?: Path;
}
