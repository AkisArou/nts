// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/compiler/debug.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { requireCompilerMember } from "../checked.ts";
import { dictionaryValue, numberValue } from "../checked.ts";
interface NamespaceLayout_Debug {
    shouldLog: {
        (level: LogLevel): boolean;
    };
    log: {
        (s: string): void;
        error: {
            (s: string): void;
        };
        warn: {
            (s: string): void;
        };
        log: {
            (s: string): void;
        };
        trace: {
            (s: string): void;
        };
    };
    getAssertionLevel: {
        (): AssertionLevel;
    };
    setAssertionLevel: {
        (level: AssertionLevel): void;
    };
    shouldAssert: {
        (level: AssertionLevel): boolean;
    };
    fail: {
        (message?: string, stackCrawlMark?: AnyFunction): never;
    };
    failBadSyntaxKind: {
        (node: Node, message?: string, stackCrawlMark?: AnyFunction): never;
    };
    assert: {
        (expression: unknown, message?: string, verboseDebugInfo?: string | (() => string), stackCrawlMark?: AnyFunction): asserts expression;
    };
    assertEqual: {
        <T>(a: T, b: T, msg?: string, msg2?: string, stackCrawlMark?: AnyFunction): void;
    };
    assertLessThan: {
        (a: number, b: number, msg?: string, stackCrawlMark?: AnyFunction): void;
    };
    assertLessThanOrEqual: {
        (a: number, b: number, stackCrawlMark?: AnyFunction): void;
    };
    assertGreaterThanOrEqual: {
        (a: number, b: number, stackCrawlMark?: AnyFunction): void;
    };
    assertIsDefined: {
        <T>(value: T, message?: string, stackCrawlMark?: AnyFunction): asserts value is NonNullable<T>;
    };
    checkDefined: {
        <T>(value: T | null | undefined, message?: string, stackCrawlMark?: AnyFunction): T;
    };
    assertEachIsDefined: {
        <T extends Node>(value: NodeArray<T>, message?: string, stackCrawlMark?: AnyFunction): asserts value is NodeArray<T>;
        <T>(value: readonly T[], message?: string, stackCrawlMark?: AnyFunction): asserts value is readonly NonNullable<T>[];
    };
    checkEachDefined: {
        <T, A extends readonly T[]>(value: A, message?: string, stackCrawlMark?: AnyFunction): A;
    };
    assertNever: {
        (member: unknown, message?: string, stackCrawlMark?: AnyFunction): never;
    };
    assertEachNode: {
        <T extends Node, U extends T>(nodes: NodeArray<T>, test: (node: T) => node is U, message?: string, stackCrawlMark?: AnyFunction): asserts nodes is NodeArray<U>;
        <T extends Node, U extends T>(nodes: readonly T[], test: (node: T) => node is U, message?: string, stackCrawlMark?: AnyFunction): asserts nodes is readonly U[];
        <T extends Node, U extends T>(nodes: NodeArray<T> | undefined, test: (node: T) => node is U, message?: string, stackCrawlMark?: AnyFunction): asserts nodes is NodeArray<U> | undefined;
        <T extends Node, U extends T>(nodes: readonly T[] | undefined, test: (node: T) => node is U, message?: string, stackCrawlMark?: AnyFunction): asserts nodes is readonly U[] | undefined;
        (nodes: readonly Node[], test: ((node: Node) => boolean) | undefined, message?: string, stackCrawlMark?: AnyFunction): void;
    };
    assertNode: {
        <T extends Node, U extends T>(node: T | undefined, test: (node: T) => node is U, message?: string, stackCrawlMark?: AnyFunction): asserts node is U;
        (node: Node | undefined, test: ((node: Node) => boolean) | undefined, message?: string, stackCrawlMark?: AnyFunction): void;
    };
    assertNotNode: {
        <T extends Node, U extends T>(node: T | undefined, test: (node: Node) => node is U, message?: string, stackCrawlMark?: AnyFunction): asserts node is Exclude<T, U>;
        (node: Node | undefined, test: ((node: Node) => boolean) | undefined, message?: string, stackCrawlMark?: AnyFunction): void;
    };
    assertOptionalNode: {
        <T extends Node, U extends T>(node: T, test: (node: T) => node is U, message?: string, stackCrawlMark?: AnyFunction): asserts node is U;
        <T extends Node, U extends T>(node: T | undefined, test: (node: T) => node is U, message?: string, stackCrawlMark?: AnyFunction): asserts node is U | undefined;
        (node: Node | undefined, test: ((node: Node) => boolean) | undefined, message?: string, stackCrawlMark?: AnyFunction): void;
    };
    assertOptionalToken: {
        <T extends Node, K extends SyntaxKind>(node: T, kind: K, message?: string, stackCrawlMark?: AnyFunction): asserts node is Extract<T, {
            kind: K;
        }>;
        <T extends Node, K extends SyntaxKind>(node: T | undefined, kind: K, message?: string, stackCrawlMark?: AnyFunction): asserts node is Extract<T, {
            kind: K;
        }> | undefined;
        (node: Node | undefined, kind: SyntaxKind | undefined, message?: string, stackCrawlMark?: AnyFunction): void;
    };
    assertMissingNode: {
        (node: Node | undefined, message?: string, stackCrawlMark?: AnyFunction): asserts node is undefined;
    };
    type: {
        <T>(value: unknown): void;
    };
    getFunctionName: {
        (func: AnyFunction): string;
    };
    formatSymbol: {
        (symbol: Symbol): string;
    };
    formatEnum: {
        (value: number | undefined, enumObject: unknown, isFlags?: boolean): string;
    };
    formatSyntaxKind: {
        (kind: SyntaxKind | undefined): string;
    };
    formatSnippetKind: {
        (kind: SnippetKind | undefined): string;
    };
    formatScriptKind: {
        (kind: ScriptKind | undefined): string;
    };
    formatNodeFlags: {
        (flags: NodeFlags | undefined): string;
    };
    formatNodeCheckFlags: {
        (flags: NodeCheckFlags | undefined): string;
    };
    formatModifierFlags: {
        (flags: ModifierFlags | undefined): string;
    };
    formatTransformFlags: {
        (flags: TransformFlags | undefined): string;
    };
    formatEmitFlags: {
        (flags: EmitFlags | undefined): string;
    };
    formatSymbolFlags: {
        (flags: SymbolFlags | undefined): string;
    };
    formatTypeFlags: {
        (flags: TypeFlags | undefined): string;
    };
    formatSignatureFlags: {
        (flags: SignatureFlags | undefined): string;
    };
    formatObjectFlags: {
        (flags: ObjectFlags | undefined): string;
    };
    formatFlowFlags: {
        (flags: FlowFlags | undefined): string;
    };
    formatRelationComparisonResult: {
        (result: RelationComparisonResult | undefined): string;
    };
    formatCheckMode: {
        (mode: CheckMode | undefined): string;
    };
    formatSignatureCheckMode: {
        (mode: SignatureCheckMode | undefined): string;
    };
    formatTypeFacts: {
        (facts: TypeFacts | undefined): string;
    };
    attachFlowNodeDebugInfo: {
        (flowNode: FlowNode): FlowNode;
    };
    attachNodeArrayDebugInfo: {
        (array: NodeArray<Node>): void;
    };
    enableDebugInfo: {
        (): void;
    };
    formatVariance: {
        (varianceFlags: VarianceFlags): string;
    };
    attachDebugPrototypeIfDebug: {
        (mapper: TypeMapper): TypeMapper;
    };
    printControlFlowGraph: {
        (flowNode: FlowNode): void;
    };
    formatControlFlowGraph: {
        (flowNode: FlowNode): string;
    };
    currentLogLevel: number;
    isDebugging: boolean;
    loggingHost?: ts.LoggingHost | undefined;
    DebugTypeMapper: {
        new (): {
            kind: number;
            __debugToString: {
                (): string;
            };
        };
        prototype: { kind: TypeMapKind; __debugToString(this: TypeMapper): string };
    };
}
interface NamespaceLayout_Debug_log {
    error: {
        (s: string): void;
    };
    warn: {
        (s: string): void;
    };
    log: {
        (s: string): void;
    };
    trace: {
        (s: string): void;
    };
}
export declare namespace Debug {
    /* eslint-enable prefer-const */
    export type AssertionKeys = MatchingKeys<typeof Debug, AnyFunction>;
    export type DebugType = Type & {
        __debugTypeToString(): string;
    }; // eslint-disable-line @typescript-eslint/naming-convention
}
import { checkedCompilerLayout, present } from "../checked.ts";
import { isCompilerIntrinsicType as checked_isCompilerIntrinsicType } from "../checkedTypes.ts";
import { isCompilerLiteralType as checked_isCompilerLiteralType } from "../checkedTypes.ts";
import { isCompilerBigIntLiteralType as checked_isCompilerBigIntLiteralType } from "../checkedTypes.ts";
import { isCompilerObjectType as checked_isCompilerObjectType } from "../checkedTypes.ts";
import { isCompilerFlowLabel as checked_isCompilerFlowLabel } from "../checkedTypes.ts";
import * as ts from "./_namespaces/ts.ts";
import { type AnyFunction, AssertionLevel, type BigIntLiteralType, CheckMode, compareValues, EmitFlags, every, FlowFlags, type FlowLabel, type FlowNode, type FlowSwitchClause, getEffectiveModifierFlagsNoCache, getEmitFlags, getOwnKeys, getParseTreeNode, getSourceFileOfNode, getSourceTextOfNodeFromSourceFile, hasProperty, idText, type IntrinsicType, isArrayTypeNode, isBigIntLiteral, isCallSignatureDeclaration, isConditionalTypeNode, isConstructorDeclaration, isConstructorTypeNode, isConstructSignatureDeclaration, isDefaultClause, isFunctionTypeNode, isGeneratedIdentifier, isGetAccessorDeclaration, isIdentifier, isImportTypeNode, isIndexedAccessTypeNode, isIndexSignatureDeclaration, isInferTypeNode, isIntersectionTypeNode, isLiteralTypeNode, isMappedTypeNode, isNamedTupleMember, isNumericLiteral, isOptionalTypeNode, isParameter, isParenthesizedTypeNode, isParseTreeNode, isPrivateIdentifier, isRestTypeNode, isSetAccessorDeclaration, isStringLiteral, isThisTypeNode, isTupleTypeNode, isTypeLiteralNode, isTypeOperatorNode, isTypeParameterDeclaration, isTypePredicateNode, isTypeQueryNode, isTypeReferenceNode, isUnionTypeNode, type LiteralType, map, type MatchingKeys, maxBy, ModifierFlags, type Node, type NodeArray, NodeCheckFlags, NodeFlags, nodeIsSynthesized, noop, objectAllocator, ObjectFlags, type ObjectType, RelationComparisonResult, ScriptKind, type Signature, SignatureCheckMode, SignatureFlags, SnippetKind, type SortedReadonlyArray, type Symbol, SymbolFlags, symbolName, SyntaxKind, toSorted, TransformFlags, type Type, TypeFacts, TypeFlags, TypeMapKind, type TypeMapper, unescapeLeadingUnderscores, VarianceFlags, zipWith } from "./_namespaces/ts.ts";
/** @internal */
export type LogLevel = number;
/** @internal */
export const LogLevel: {
    readonly Off: 0;
    readonly Error: 1;
    readonly Warning: 2;
    readonly Info: 3;
    readonly Verbose: 4;
    [index: number]: string;
} = {
    Off: 0,
    "0": "Off",
    Error: 1,
    "1": "Error",
    Warning: 2,
    "2": "Warning",
    Info: 3,
    "3": "Info",
    Verbose: 4,
    "4": "Verbose"
};
/** @internal */
export interface LoggingHost {
    log(level: LogLevel, s: string): void;
}
export const Debug: NamespaceLayout_Debug = (function (): NamespaceLayout_Debug {
    /* eslint-disable prefer-const */
    let currentAssertionLevel: AssertionLevel = AssertionLevel.None;
    let currentLogLevel: LogLevel = LogLevel.Warning;
    let isDebugging = false;
    let loggingHost: LoggingHost | undefined;
    /* eslint-enable prefer-const */
    type AssertionKeys = MatchingKeys<typeof Debug, AnyFunction>;
    function shouldLog(level: LogLevel): boolean {
        return Debug.currentLogLevel <= level;
    }
    function logMessage(level: LogLevel, s: string): void {
        if (Debug.loggingHost && shouldLog(level)) {
            Debug.loggingHost.log(level, s);
        }
    }
    function log(s: string): void {
        logMessage(LogLevel.Info, s);
    }
    const log_namespace: typeof log & NamespaceLayout_Debug_log = (function (): typeof log & NamespaceLayout_Debug_log {
        const namespaceValue: typeof log & Partial<NamespaceLayout_Debug_log> = log;
        function error(s: string): void {
            logMessage(LogLevel.Error, s);
        }
        function warn(s: string): void {
            logMessage(LogLevel.Warning, s);
        }
        function log(s: string): void {
            logMessage(LogLevel.Info, s);
        }
        function trace(s: string): void {
            logMessage(LogLevel.Verbose, s);
        }
        namespaceValue.error = error;
        namespaceValue.warn = warn;
        namespaceValue.log = log;
        namespaceValue.trace = trace;
        function isCompleteNamespace(value: typeof log & Partial<NamespaceLayout_Debug_log>): value is typeof log & NamespaceLayout_Debug_log {
            return value.error !== undefined && value.warn !== undefined && value.log !== undefined && value.trace !== undefined;
        }
        if (!isCompleteNamespace(namespaceValue))
            throw new TypeError("Incomplete compiler namespace Debug.log");
        return namespaceValue;
    })();
    const assertionCache: Record<string, { level: AssertionLevel; assertion: AnyFunction } | undefined> = {};
    function getAssertionLevel(): AssertionLevel {
        return currentAssertionLevel;
    }
    function setAssertionLevel(level: AssertionLevel): void {
        const prevAssertionLevel = currentAssertionLevel;
        currentAssertionLevel = level;
        if (level > prevAssertionLevel) {
            // restore assertion functions for the current assertion level (see `shouldAssertFunction`).
            for (const key of getOwnKeys(assertionCache)) {
                const cachedFunc = assertionCache[key];
                if (cachedFunc !== undefined && dictionaryValue(Debug)[key] !== cachedFunc.assertion && level >= cachedFunc.level) {
                    dictionaryValue(Debug)[key] = cachedFunc;
                    assertionCache[key] = undefined;
                }
            }
        }
    }
    function shouldAssert(level: AssertionLevel): boolean {
        return currentAssertionLevel >= level;
    }
    /**
     * Tests whether an assertion function should be executed. If it shouldn't, it is cached and replaced with `ts.noop`.
     * Replaced assertion functions are restored when `Debug.setAssertionLevel` is set to a high enough level.
     * @param level The minimum assertion level required.
     * @param name The name of the current assertion function.
     */
    function shouldAssertFunction<K extends AssertionKeys>(level: AssertionLevel, name: K): boolean {
        if (!shouldAssert(level)) {
            assertionCache[name] = { level, assertion: Debug[name] };
            dictionaryValue(Debug)[name] = noop;
            return false;
        }
        return true;
    }
    function fail(message?: string, stackCrawlMark?: AnyFunction): never {
        // eslint-disable-next-line no-debugger
        debugger;
        const e = new Error(message ? `Debug Failure. ${message}` : "Debug Failure.");
        if ((Error).captureStackTrace) {
            (Error).captureStackTrace(e, stackCrawlMark || fail);
        }
        throw e;
    }
    function failBadSyntaxKind(node: Node, message?: string, stackCrawlMark?: AnyFunction): never {
        return fail(`${message || "Unexpected node."}\r\nNode ${formatSyntaxKind(node.kind)} was unexpected.`, stackCrawlMark || failBadSyntaxKind);
    }
    function assert(expression: unknown, message?: string, verboseDebugInfo?: string | (() => string), stackCrawlMark?: AnyFunction): asserts expression {
        if (!expression) {
            message = message ? `False expression: ${message}` : "False expression.";
            if (verboseDebugInfo) {
                message += "\r\nVerbose Debug Information: " + (typeof verboseDebugInfo === "string" ? verboseDebugInfo : verboseDebugInfo());
            }
            fail(message, stackCrawlMark || assert);
        }
    }
    function assertEqual<T>(a: T, b: T, msg?: string, msg2?: string, stackCrawlMark?: AnyFunction): void {
        if (a !== b) {
            const message = msg ? msg2 ? `${msg} ${msg2}` : msg : "";
            fail(`Expected ${a} === ${b}. ${message}`, stackCrawlMark || assertEqual);
        }
    }
    function assertLessThan(a: number, b: number, msg?: string, stackCrawlMark?: AnyFunction): void {
        if (a >= b) {
            fail(`Expected ${a} < ${b}. ${msg || ""}`, stackCrawlMark || assertLessThan);
        }
    }
    function assertLessThanOrEqual(a: number, b: number, stackCrawlMark?: AnyFunction): void {
        if (a > b) {
            fail(`Expected ${a} <= ${b}`, stackCrawlMark || assertLessThanOrEqual);
        }
    }
    function assertGreaterThanOrEqual(a: number, b: number, stackCrawlMark?: AnyFunction): void {
        if (a < b) {
            fail(`Expected ${a} >= ${b}`, stackCrawlMark || assertGreaterThanOrEqual);
        }
    }
    function assertIsDefined<T>(value: T, message?: string, stackCrawlMark?: AnyFunction): asserts value is NonNullable<T> {
        // eslint-disable-next-line no-restricted-syntax
        if (value === undefined || value === null) {
            fail(message, stackCrawlMark || assertIsDefined);
        }
    }
    function checkDefined<T>(value: T | null | undefined, message?: string, stackCrawlMark?: AnyFunction): T {
        assertIsDefined(value, message, stackCrawlMark || checkDefined);
        return value;
    }
    function assertEachIsDefined<T extends Node>(value: NodeArray<T>, message?: string, stackCrawlMark?: AnyFunction): asserts value is NodeArray<T>;
    function assertEachIsDefined<T>(value: readonly T[], message?: string, stackCrawlMark?: AnyFunction): asserts value is readonly NonNullable<T>[];
    function assertEachIsDefined<T>(value: readonly T[], message?: string, stackCrawlMark?: AnyFunction) {
        for (const v of value) {
            assertIsDefined(v, message, stackCrawlMark || assertEachIsDefined);
        }
    }
    function checkEachDefined<T, A extends readonly T[]>(value: A, message?: string, stackCrawlMark?: AnyFunction): A {
        assertEachIsDefined(value, message, stackCrawlMark || checkEachDefined);
        return value;
    }
    function assertNever(member: unknown, message = "Illegal value:", stackCrawlMark?: AnyFunction): never {
        const detail = typeof member === "object" && hasProperty(member, "kind") && hasProperty(member, "pos") ? "SyntaxKind: " + formatSyntaxKind(numberValue(dictionaryValue(member).kind)) : JSON.stringify(member);
        return fail(`${message} ${detail}`, stackCrawlMark || assertNever);
    }
    function assertEachNode<T extends Node, U extends T>(nodes: NodeArray<T>, test: (node: T) => node is U, message?: string, stackCrawlMark?: AnyFunction): asserts nodes is NodeArray<U>;
    function assertEachNode<T extends Node, U extends T>(nodes: readonly T[], test: (node: T) => node is U, message?: string, stackCrawlMark?: AnyFunction): asserts nodes is readonly U[];
    function assertEachNode<T extends Node, U extends T>(nodes: NodeArray<T> | undefined, test: (node: T) => node is U, message?: string, stackCrawlMark?: AnyFunction): asserts nodes is NodeArray<U> | undefined;
    function assertEachNode<T extends Node, U extends T>(nodes: readonly T[] | undefined, test: (node: T) => node is U, message?: string, stackCrawlMark?: AnyFunction): asserts nodes is readonly U[] | undefined;
    function assertEachNode(nodes: readonly Node[], test: ((node: Node) => boolean) | undefined, message?: string, stackCrawlMark?: AnyFunction): void;
    function assertEachNode(nodes: readonly Node[] | undefined, test: ((node: Node) => boolean) | undefined, message?: string, stackCrawlMark?: AnyFunction) {
        if (shouldAssertFunction(AssertionLevel.Normal, "assertEachNode")) {
            assert(test === undefined || every(nodes, test), message || "Unexpected node.", () => `Node array did not pass test '${getFunctionName((test)!)}'.`, stackCrawlMark || assertEachNode);
        }
    }
    function assertNode<T extends Node, U extends T>(node: T | undefined, test: (node: T) => node is U, message?: string, stackCrawlMark?: AnyFunction): asserts node is U;
    function assertNode(node: Node | undefined, test: ((node: Node) => boolean) | undefined, message?: string, stackCrawlMark?: AnyFunction): void;
    function assertNode(node: Node | undefined, test: ((node: Node) => boolean) | undefined, message?: string, stackCrawlMark?: AnyFunction) {
        if (shouldAssertFunction(AssertionLevel.Normal, "assertNode")) {
            assert(node !== undefined && (test === undefined || test(node)), message || "Unexpected node.", () => `Node ${formatSyntaxKind(node?.kind)} did not pass test '${getFunctionName((test)!)}'.`, stackCrawlMark || assertNode);
        }
    }
    function assertNotNode<T extends Node, U extends T>(node: T | undefined, test: (node: Node) => node is U, message?: string, stackCrawlMark?: AnyFunction): asserts node is Exclude<T, U>;
    function assertNotNode(node: Node | undefined, test: ((node: Node) => boolean) | undefined, message?: string, stackCrawlMark?: AnyFunction): void;
    function assertNotNode(node: Node | undefined, test: ((node: Node) => boolean) | undefined, message?: string, stackCrawlMark?: AnyFunction) {
        if (shouldAssertFunction(AssertionLevel.Normal, "assertNotNode")) {
            assert(node === undefined || test === undefined || !test(node), message || "Unexpected node.", () => `Node ${formatSyntaxKind((node)!.kind)} should not have passed test '${getFunctionName((test)!)}'.`, stackCrawlMark || assertNotNode);
        }
    }
    function assertOptionalNode<T extends Node, U extends T>(node: T, test: (node: T) => node is U, message?: string, stackCrawlMark?: AnyFunction): asserts node is U;
    function assertOptionalNode<T extends Node, U extends T>(node: T | undefined, test: (node: T) => node is U, message?: string, stackCrawlMark?: AnyFunction): asserts node is U | undefined;
    function assertOptionalNode(node: Node | undefined, test: ((node: Node) => boolean) | undefined, message?: string, stackCrawlMark?: AnyFunction): void;
    function assertOptionalNode(node: Node | undefined, test: ((node: Node) => boolean) | undefined, message?: string, stackCrawlMark?: AnyFunction) {
        if (shouldAssertFunction(AssertionLevel.Normal, "assertOptionalNode")) {
            assert(test === undefined || node === undefined || test(node), message || "Unexpected node.", () => `Node ${formatSyntaxKind(node?.kind)} did not pass test '${getFunctionName((test)!)}'.`, stackCrawlMark || assertOptionalNode);
        }
    }
    function assertOptionalToken<T extends Node, K extends SyntaxKind>(node: T, kind: K, message?: string, stackCrawlMark?: AnyFunction): asserts node is Extract<T, {
        kind: K;
    }>;
    function assertOptionalToken<T extends Node, K extends SyntaxKind>(node: T | undefined, kind: K, message?: string, stackCrawlMark?: AnyFunction): asserts node is Extract<T, {
        kind: K;
    }> | undefined;
    function assertOptionalToken(node: Node | undefined, kind: SyntaxKind | undefined, message?: string, stackCrawlMark?: AnyFunction): void;
    function assertOptionalToken(node: Node | undefined, kind: SyntaxKind | undefined, message?: string, stackCrawlMark?: AnyFunction) {
        if (shouldAssertFunction(AssertionLevel.Normal, "assertOptionalToken")) {
            assert(kind === undefined || node === undefined || node.kind === kind, message || "Unexpected node.", () => `Node ${formatSyntaxKind(node?.kind)} was not a '${formatSyntaxKind(kind)}' token.`, stackCrawlMark || assertOptionalToken);
        }
    }
    function assertMissingNode(node: Node | undefined, message?: string, stackCrawlMark?: AnyFunction): asserts node is undefined;
    function assertMissingNode(node: Node | undefined, message?: string, stackCrawlMark?: AnyFunction) {
        if (shouldAssertFunction(AssertionLevel.Normal, "assertMissingNode")) {
            assert(node === undefined, message || "Unexpected node.", () => `Node ${formatSyntaxKind((node)!.kind)} was unexpected'.`, stackCrawlMark || assertMissingNode);
        }
    }
    /**
     * Asserts a value has the specified type in typespace only (does not perform a runtime assertion).
     * This is useful in cases where we switch on `node.kind` and can be reasonably sure the type is accurate, and
     * as a result can reduce the number of unnecessary casts.
     */
    function type<T>(value: unknown): void;
    function type(_value: unknown) { }
    function getFunctionName(func: AnyFunction): string {
        if (typeof func !== "function") {
            return "";
        }
        else if (hasProperty(func, "name")) {
            return (func).name;
        }
        else {
            const text = Function.prototype.toString.call(func);
            const match = /^function\s+([\w$]+)\s*\(/.exec(text);
            return match ? match[1] : "";
        }
    }
    function formatSymbol(symbol: Symbol): string {
        return `{ name: ${unescapeLeadingUnderscores(symbol.escapedName)}; flags: ${formatSymbolFlags(symbol.flags)}; declarations: ${map(symbol.declarations, node => formatSyntaxKind(node.kind))} }`;
    }
    /**
     * Formats an enum value as a string for debugging and debug assertions.
     */
    function formatEnum(value = 0, enumObject: unknown, isFlags?: boolean): string {
        const members = getEnumMembers(enumObject);
        if (value === 0) {
            return members.length > 0 && members[0][0] === 0 ? members[0][1] : "0";
        }
        if (isFlags) {
            const result: string[] = [];
            let remainingFlags = value;
            for (const [enumValue, enumName] of members) {
                if (enumValue > value) {
                    break;
                }
                if (enumValue !== 0 && enumValue & value) {
                    result.push(enumName);
                    remainingFlags &= ~enumValue;
                }
            }
            if (remainingFlags === 0) {
                return result.join("|");
            }
        }
        else {
            for (const [enumValue, enumName] of members) {
                if (enumValue === value) {
                    return enumName;
                }
            }
        }
        return value.toString();
    }
    const enumMemberCache = new Map<unknown, SortedReadonlyArray<[
        number,
        string
    ]>>();
    function getEnumMembers(enumObject: unknown) {
        // Assuming enum objects do not change at runtime, we can cache the enum members list
        // to reuse later. This saves us from reconstructing this each and every time we call
        // a formatting function (which can be expensive for large enums like SyntaxKind).
        const existing = enumMemberCache.get(enumObject);
        if (existing) {
            return existing;
        }
        const result: [
            number,
            string
        ][] = [];
        for (const name in dictionaryValue(enumObject)) {
            const value = dictionaryValue(enumObject)[name];
            if (typeof value === "number") {
                result.push([value, name]);
            }
        }
        const sorted = toSorted<[
            number,
            string
        ]>(result, (x, y) => compareValues(x[0], y[0]));
        enumMemberCache.set(enumObject, sorted);
        return sorted;
    }
    function formatSyntaxKind(kind: SyntaxKind | undefined): string {
        return formatEnum(kind, (ts).SyntaxKind, /*isFlags*/ false);
    }
    function formatSnippetKind(kind: SnippetKind | undefined): string {
        return formatEnum(kind, (ts).SnippetKind, /*isFlags*/ false);
    }
    function formatScriptKind(kind: ScriptKind | undefined): string {
        return formatEnum(kind, (ts).ScriptKind, /*isFlags*/ false);
    }
    function formatNodeFlags(flags: NodeFlags | undefined): string {
        return formatEnum(flags, (ts).NodeFlags, /*isFlags*/ true);
    }
    function formatNodeCheckFlags(flags: NodeCheckFlags | undefined): string {
        return formatEnum(flags, (ts).NodeCheckFlags, /*isFlags*/ true);
    }
    function formatModifierFlags(flags: ModifierFlags | undefined): string {
        return formatEnum(flags, (ts).ModifierFlags, /*isFlags*/ true);
    }
    function formatTransformFlags(flags: TransformFlags | undefined): string {
        return formatEnum(flags, (ts).TransformFlags, /*isFlags*/ true);
    }
    function formatEmitFlags(flags: EmitFlags | undefined): string {
        return formatEnum(flags, (ts).EmitFlags, /*isFlags*/ true);
    }
    function formatSymbolFlags(flags: SymbolFlags | undefined): string {
        return formatEnum(flags, (ts).SymbolFlags, /*isFlags*/ true);
    }
    function formatTypeFlags(flags: TypeFlags | undefined): string {
        return formatEnum(flags, (ts).TypeFlags, /*isFlags*/ true);
    }
    function formatSignatureFlags(flags: SignatureFlags | undefined): string {
        return formatEnum(flags, (ts).SignatureFlags, /*isFlags*/ true);
    }
    function formatObjectFlags(flags: ObjectFlags | undefined): string {
        return formatEnum(flags, (ts).ObjectFlags, /*isFlags*/ true);
    }
    function formatFlowFlags(flags: FlowFlags | undefined): string {
        return formatEnum(flags, (ts).FlowFlags, /*isFlags*/ true);
    }
    function formatRelationComparisonResult(result: RelationComparisonResult | undefined): string {
        return formatEnum(result, (ts).RelationComparisonResult, /*isFlags*/ true);
    }
    function formatCheckMode(mode: CheckMode | undefined): string {
        return formatEnum(mode, (ts).CheckMode, /*isFlags*/ true);
    }
    function formatSignatureCheckMode(mode: SignatureCheckMode | undefined): string {
        return formatEnum(mode, (ts).SignatureCheckMode, /*isFlags*/ true);
    }
    function formatTypeFacts(facts: TypeFacts | undefined): string {
        return formatEnum(facts, (ts).TypeFacts, /*isFlags*/ true);
    }
    let isDebugInfoEnabled = false;
    let flowNodeProto: FlowNode | undefined;
    function attachFlowNodeDebugInfoWorker(flowNode: FlowNode) {
        if (!("__debugFlowFlags" in flowNode)) { // eslint-disable-line local/no-in-operator
            Object.defineProperties(flowNode, {
                // for use with vscode-js-debug's new customDescriptionGenerator in launch.json
                __tsDebuggerDisplay: {
                    value(this: FlowNode) {
                        const flowHeader = this.flags & FlowFlags.Start ? "FlowStart" :
                            this.flags & FlowFlags.BranchLabel ? "FlowBranchLabel" :
                                this.flags & FlowFlags.LoopLabel ? "FlowLoopLabel" :
                                    this.flags & FlowFlags.Assignment ? "FlowAssignment" :
                                        this.flags & FlowFlags.TrueCondition ? "FlowTrueCondition" :
                                            this.flags & FlowFlags.FalseCondition ? "FlowFalseCondition" :
                                                this.flags & FlowFlags.SwitchClause ? "FlowSwitchClause" :
                                                    this.flags & FlowFlags.ArrayMutation ? "FlowArrayMutation" :
                                                        this.flags & FlowFlags.Call ? "FlowCall" :
                                                            this.flags & FlowFlags.ReduceLabel ? "FlowReduceLabel" :
                                                                this.flags & FlowFlags.Unreachable ? "FlowUnreachable" :
                                                                    "UnknownFlow";
                        const remainingFlags = this.flags & ~(FlowFlags.Referenced - 1);
                        return `${flowHeader}${remainingFlags ? ` (${formatFlowFlags(remainingFlags)})` : ""}`;
                    },
                },
                __debugFlowFlags: {
                    get(this: FlowNode) {
                        return formatEnum(this.flags, (ts).FlowFlags, /*isFlags*/ true);
                    },
                },
                __debugToString: {
                    value(this: FlowNode) {
                        return formatControlFlowGraph(this);
                    },
                },
            });
        }
    }
    function attachFlowNodeDebugInfo(flowNode: FlowNode): FlowNode {
        if (isDebugInfoEnabled) {
            if (typeof Object.setPrototypeOf === "function") {
                // if we're in es2015, attach the method to a shared prototype for `FlowNode`
                // so the method doesn't show up in the watch window.
                if (!flowNodeProto) {
                    flowNodeProto = Object.create(Object.prototype);
                    attachFlowNodeDebugInfoWorker((flowNodeProto)!);
                }
                Object.setPrototypeOf(flowNode, (flowNodeProto)!);
            }
            else {
                // not running in an es2015 environment, attach the method directly.
                attachFlowNodeDebugInfoWorker(flowNode);
            }
        }
        return flowNode;
    }
    let nodeArrayProto: NodeArray<Node> | undefined;
    function attachNodeArrayDebugInfoWorker(array: NodeArray<Node>) {
        if (!("__tsDebuggerDisplay" in array)) { // eslint-disable-line local/no-in-operator
            Object.defineProperties(array, {
                __tsDebuggerDisplay: {
                    value(this: NodeArray<Node>, defaultValue: string) {
                        // An `Array` with extra properties is rendered as `[A, B, prop1: 1, prop2: 2]`. Most of
                        // these aren't immediately useful so we trim off the `prop1: ..., prop2: ...` part from the
                        // formatted string.
                        // This regex can trigger slow backtracking because of overlapping potential captures.
                        // We don't care, this is debug code that's only enabled with a debugger attached -
                        // we're just taking note of it for anyone checking regex performance in the future.
                        defaultValue = String(defaultValue).replace(/(?:,[\s\w]+:[^,]+)+\]$/, "]");
                        return `NodeArray ${defaultValue}`;
                    },
                },
            });
        }
    }
    function attachNodeArrayDebugInfo(array: NodeArray<Node>): void {
        if (isDebugInfoEnabled) {
            if (typeof Object.setPrototypeOf === "function") {
                // if we're in es2015, attach the method to a shared prototype for `NodeArray`
                // so the method doesn't show up in the watch window.
                if (!nodeArrayProto) {
                    nodeArrayProto = Object.create(Array.prototype);
                    attachNodeArrayDebugInfoWorker((nodeArrayProto)!);
                }
                Object.setPrototypeOf(array, (nodeArrayProto)!);
            }
            else {
                // not running in an es2015 environment, attach the method directly.
                attachNodeArrayDebugInfoWorker(array);
            }
        }
    }
    /**
     * Injects debug information into frequently used types.
     */
    function enableDebugInfo(): void {
        if (isDebugInfoEnabled)
            return;
        // avoid recomputing
        const weakTypeTextMap = new WeakMap<Type, string>();
        const weakNodeTextMap = new WeakMap<Node, string>();
        // Add additional properties in debug mode to assist with debugging.
        Object.defineProperties(objectAllocator.getSymbolConstructor().prototype, {
            // for use with vscode-js-debug's new customDescriptionGenerator in launch.json
            __tsDebuggerDisplay: {
                value(this: Symbol) {
                    const symbolHeader = this.flags & SymbolFlags.Transient ? "TransientSymbol" :
                        "Symbol";
                    const remainingSymbolFlags = this.flags & ~SymbolFlags.Transient;
                    return `${symbolHeader} '${symbolName(this)}'${remainingSymbolFlags ? ` (${formatSymbolFlags(remainingSymbolFlags)})` : ""}`;
                },
            },
            __debugFlags: {
                get(this: Symbol) {
                    return formatSymbolFlags(this.flags);
                },
            },
        });
        Object.defineProperties(objectAllocator.getTypeConstructor().prototype, {
            // for use with vscode-js-debug's new customDescriptionGenerator in launch.json
            __tsDebuggerDisplay: {
                value(this: Type) {
                    const typeHeader = this.flags & TypeFlags.Intrinsic ? `IntrinsicType ${(checkedCompilerLayout(this, checked_isCompilerIntrinsicType)).intrinsicName}${(checkedCompilerLayout(this, checked_isCompilerIntrinsicType)).debugIntrinsicName ? ` (${(checkedCompilerLayout(this, checked_isCompilerIntrinsicType)).debugIntrinsicName})` : ""}` :
                        this.flags & TypeFlags.Nullable ? "NullableType" :
                            this.flags & TypeFlags.StringOrNumberLiteral ? `LiteralType ${JSON.stringify((checkedCompilerLayout(this, checked_isCompilerLiteralType)).value)}` :
                                this.flags & TypeFlags.BigIntLiteral ? `LiteralType ${(checkedCompilerLayout(this, checked_isCompilerBigIntLiteralType)).value.negative ? "-" : ""}${(checkedCompilerLayout(this, checked_isCompilerBigIntLiteralType)).value.base10Value}n` :
                                    this.flags & TypeFlags.UniqueESSymbol ? "UniqueESSymbolType" :
                                        this.flags & TypeFlags.Enum ? "EnumType" :
                                            this.flags & TypeFlags.Union ? "UnionType" :
                                                this.flags & TypeFlags.Intersection ? "IntersectionType" :
                                                    this.flags & TypeFlags.Index ? "IndexType" :
                                                        this.flags & TypeFlags.IndexedAccess ? "IndexedAccessType" :
                                                            this.flags & TypeFlags.Conditional ? "ConditionalType" :
                                                                this.flags & TypeFlags.Substitution ? "SubstitutionType" :
                                                                    this.flags & TypeFlags.TypeParameter ? "TypeParameter" :
                                                                        this.flags & TypeFlags.Object ?
                                                                            (checkedCompilerLayout(this, checked_isCompilerObjectType)).objectFlags & ObjectFlags.ClassOrInterface ? "InterfaceType" :
                                                                                (checkedCompilerLayout(this, checked_isCompilerObjectType)).objectFlags & ObjectFlags.Reference ? "TypeReference" :
                                                                                    (checkedCompilerLayout(this, checked_isCompilerObjectType)).objectFlags & ObjectFlags.Tuple ? "TupleType" :
                                                                                        (checkedCompilerLayout(this, checked_isCompilerObjectType)).objectFlags & ObjectFlags.Anonymous ? "AnonymousType" :
                                                                                            (checkedCompilerLayout(this, checked_isCompilerObjectType)).objectFlags & ObjectFlags.Mapped ? "MappedType" :
                                                                                                (checkedCompilerLayout(this, checked_isCompilerObjectType)).objectFlags & ObjectFlags.ReverseMapped ? "ReverseMappedType" :
                                                                                                    (checkedCompilerLayout(this, checked_isCompilerObjectType)).objectFlags & ObjectFlags.EvolvingArray ? "EvolvingArrayType" :
                                                                                                        "ObjectType" :
                                                                            "Type";
                    const remainingObjectFlags = this.flags & TypeFlags.Object ? (checkedCompilerLayout(this, checked_isCompilerObjectType)).objectFlags & ~ObjectFlags.ObjectTypeKindMask : 0;
                    return `${typeHeader}${this.symbol ? ` '${symbolName(this.symbol)}'` : ""}${remainingObjectFlags ? ` (${formatObjectFlags(remainingObjectFlags)})` : ""}`;
                },
            },
            __debugFlags: {
                get(this: Type) {
                    return formatTypeFlags(this.flags);
                },
            },
            __debugObjectFlags: {
                get(this: Type) {
                    return this.flags & TypeFlags.Object ? formatObjectFlags((checkedCompilerLayout(this, checked_isCompilerObjectType)).objectFlags) : "";
                },
            },
            __debugTypeToString: {
                value(this: Type) {
                    // avoid recomputing
                    let text = weakTypeTextMap.get(this);
                    if (text === undefined) {
                        text = (this.checker)!.typeToString(this);
                        weakTypeTextMap.set(this, text);
                    }
                    return text;
                },
            },
        });
        Object.defineProperties(objectAllocator.getSignatureConstructor().prototype, {
            __debugFlags: {
                get(this: Signature) {
                    return formatSignatureFlags(this.flags);
                },
            },
            __debugSignatureToString: {
                value(this: Signature) {
                    return this.checker?.signatureToString(this);
                },
            },
        });
        const nodeConstructors = [
            objectAllocator.getNodeConstructor(),
            objectAllocator.getIdentifierConstructor(),
            objectAllocator.getTokenConstructor(),
            objectAllocator.getSourceFileConstructor(),
        ];
        for (const ctor of nodeConstructors) {
            if (!hasProperty(ctor.prototype, "__debugKind")) {
                Object.defineProperties(ctor.prototype, {
                    // for use with vscode-js-debug's new customDescriptionGenerator in launch.json
                    __tsDebuggerDisplay: {
                        value(this: Node) {
                            const nodeHeader = isGeneratedIdentifier(this) ? "GeneratedIdentifier" :
                                isIdentifier(this) ? `Identifier '${idText(this)}'` :
                                    isPrivateIdentifier(this) ? `PrivateIdentifier '${idText(this)}'` :
                                        isStringLiteral(this) ? `StringLiteral ${JSON.stringify(this.text.length < 10 ? this.text : this.text.slice(10) + "...")}` :
                                            isNumericLiteral(this) ? `NumericLiteral ${this.text}` :
                                                isBigIntLiteral(this) ? `BigIntLiteral ${this.text}n` :
                                                    isTypeParameterDeclaration(this) ? "TypeParameterDeclaration" :
                                                        isParameter(this) ? "ParameterDeclaration" :
                                                            isConstructorDeclaration(this) ? "ConstructorDeclaration" :
                                                                isGetAccessorDeclaration(this) ? "GetAccessorDeclaration" :
                                                                    isSetAccessorDeclaration(this) ? "SetAccessorDeclaration" :
                                                                        isCallSignatureDeclaration(this) ? "CallSignatureDeclaration" :
                                                                            isConstructSignatureDeclaration(this) ? "ConstructSignatureDeclaration" :
                                                                                isIndexSignatureDeclaration(this) ? "IndexSignatureDeclaration" :
                                                                                    isTypePredicateNode(this) ? "TypePredicateNode" :
                                                                                        isTypeReferenceNode(this) ? "TypeReferenceNode" :
                                                                                            isFunctionTypeNode(this) ? "FunctionTypeNode" :
                                                                                                isConstructorTypeNode(this) ? "ConstructorTypeNode" :
                                                                                                    isTypeQueryNode(this) ? "TypeQueryNode" :
                                                                                                        isTypeLiteralNode(this) ? "TypeLiteralNode" :
                                                                                                            isArrayTypeNode(this) ? "ArrayTypeNode" :
                                                                                                                isTupleTypeNode(this) ? "TupleTypeNode" :
                                                                                                                    isOptionalTypeNode(this) ? "OptionalTypeNode" :
                                                                                                                        isRestTypeNode(this) ? "RestTypeNode" :
                                                                                                                            isUnionTypeNode(this) ? "UnionTypeNode" :
                                                                                                                                isIntersectionTypeNode(this) ? "IntersectionTypeNode" :
                                                                                                                                    isConditionalTypeNode(this) ? "ConditionalTypeNode" :
                                                                                                                                        isInferTypeNode(this) ? "InferTypeNode" :
                                                                                                                                            isParenthesizedTypeNode(this) ? "ParenthesizedTypeNode" :
                                                                                                                                                isThisTypeNode(this) ? "ThisTypeNode" :
                                                                                                                                                    isTypeOperatorNode(this) ? "TypeOperatorNode" :
                                                                                                                                                        isIndexedAccessTypeNode(this) ? "IndexedAccessTypeNode" :
                                                                                                                                                            isMappedTypeNode(this) ? "MappedTypeNode" :
                                                                                                                                                                isLiteralTypeNode(this) ? "LiteralTypeNode" :
                                                                                                                                                                    isNamedTupleMember(this) ? "NamedTupleMember" :
                                                                                                                                                                        isImportTypeNode(this) ? "ImportTypeNode" :
                                                                                                                                                                            formatSyntaxKind(this.kind);
                            return `${nodeHeader}${this.flags ? ` (${formatNodeFlags(this.flags)})` : ""}`;
                        },
                    },
                    __debugKind: {
                        get(this: Node) {
                            return formatSyntaxKind(this.kind);
                        },
                    },
                    __debugNodeFlags: {
                        get(this: Node) {
                            return formatNodeFlags(this.flags);
                        },
                    },
                    __debugModifierFlags: {
                        get(this: Node) {
                            return formatModifierFlags(getEffectiveModifierFlagsNoCache(this));
                        },
                    },
                    __debugTransformFlags: {
                        get(this: Node) {
                            return formatTransformFlags(this.transformFlags);
                        },
                    },
                    __debugIsParseTreeNode: {
                        get(this: Node) {
                            return isParseTreeNode(this);
                        },
                    },
                    __debugEmitFlags: {
                        get(this: Node) {
                            return formatEmitFlags(getEmitFlags(this));
                        },
                    },
                    __debugGetText: {
                        value(this: Node, includeTrivia?: boolean) {
                            if (nodeIsSynthesized(this))
                                return "";
                            // avoid recomputing
                            let text = weakNodeTextMap.get(this);
                            if (text === undefined) {
                                const parseNode = getParseTreeNode(this);
                                const sourceFile = parseNode && getSourceFileOfNode(parseNode);
                                text = sourceFile ? getSourceTextOfNodeFromSourceFile(sourceFile, parseNode, includeTrivia) : "";
                                weakNodeTextMap.set(this, text);
                            }
                            return text;
                        },
                    },
                });
            }
        }
        isDebugInfoEnabled = true;
    }
    function formatVariance(varianceFlags: VarianceFlags): string {
        const variance = varianceFlags & VarianceFlags.VarianceMask;
        let result = variance === VarianceFlags.Invariant ? "in out" :
            variance === VarianceFlags.Bivariant ? "[bivariant]" :
                variance === VarianceFlags.Contravariant ? "in" :
                    variance === VarianceFlags.Covariant ? "out" :
                        variance === VarianceFlags.Independent ? "[independent]" : "";
        if (varianceFlags & VarianceFlags.Unmeasurable) {
            result += " (unmeasurable)";
        }
        else if (varianceFlags & VarianceFlags.Unreliable) {
            result += " (unreliable)";
        }
        return result;
    }
    type DebugType = Type & {
        __debugTypeToString(): string;
    }; // eslint-disable-line @typescript-eslint/naming-convention
    class DebugTypeMapper {
        declare kind: TypeMapKind;
        __debugToString(this: TypeMapper): string {
            type<TypeMapper>(this);
            switch (this.kind) {
                case TypeMapKind.Function:
                    return this.debugInfo?.() || "(function mapper)";
                case TypeMapKind.Simple:
                    return `${requireCompilerMember(this.source, "__debugTypeToString").__debugTypeToString()} -> ${requireCompilerMember(this.target, "__debugTypeToString").__debugTypeToString()}`;
                case TypeMapKind.Array:
                    return zipWith<Type, Type | string, unknown>(this.sources, this.targets || map(this.sources, () => "any"), (s, t) => `${requireCompilerMember(s, "__debugTypeToString").__debugTypeToString()} -> ${typeof t === "string" ? t : requireCompilerMember(t, "__debugTypeToString").__debugTypeToString()}`).join(", ");
                case TypeMapKind.Deferred:
                    return zipWith(this.sources, this.targets, (s, t) => `${requireCompilerMember(s, "__debugTypeToString").__debugTypeToString()} -> ${requireCompilerMember(t(), "__debugTypeToString").__debugTypeToString()}`).join(", ");
                case TypeMapKind.Merged:
                case TypeMapKind.Composite:
                    return `m1: ${requireCompilerMember(this.mapper1, "__debugToString").__debugToString().split("\n").join("\n    ")}
m2: ${requireCompilerMember(this.mapper2, "__debugToString").__debugToString().split("\n").join("\n    ")}`;
                default:
                    return assertNever(this);
            }
        }
    }
    function attachDebugPrototypeIfDebug(mapper: TypeMapper): TypeMapper {
        if (Debug.isDebugging) {
            return Object.setPrototypeOf(mapper, DebugTypeMapper.prototype);
        }
        return mapper;
    }
    function printControlFlowGraph(flowNode: FlowNode): void {
        return console.log(formatControlFlowGraph(flowNode));
    }
    function formatControlFlowGraph(flowNode: FlowNode): string {
        let nextDebugFlowId = -1;
        function getDebugFlowNodeId(f: FlowNode) {
            if (!f.id) {
                f.id = nextDebugFlowId;
                nextDebugFlowId--;
            }
            return f.id;
        }
        type BoxCharacter = "\u2500" | "\u2502" | "\u256D" | "\u256E" | "\u256F" | "\u2570" | "\u251C" | "\u2524" | "\u252C" | "\u2534" | "\u256B";
        const BoxCharacter: {
            readonly lr: "\u2500";
            readonly ud: "\u2502";
            readonly dr: "\u256D";
            readonly dl: "\u256E";
            readonly ul: "\u256F";
            readonly ur: "\u2570";
            readonly udr: "\u251C";
            readonly udl: "\u2524";
            readonly dlr: "\u252C";
            readonly ulr: "\u2534";
            readonly udlr: "\u256B";
        } = {
            lr: "\u2500",
            ud: "\u2502",
            dr: "\u256D",
            dl: "\u256E",
            ul: "\u256F",
            ur: "\u2570",
            udr: "\u251C",
            udl: "\u2524",
            dlr: "\u252C",
            ulr: "\u2534",
            udlr: "\u256B"
        };
        type Connection = number;
        const Connection: {
            readonly None: 0;
            readonly Up: 1;
            readonly Down: 2;
            readonly Left: 4;
            readonly Right: 8;
            readonly UpDown: 3;
            readonly LeftRight: 12;
            readonly UpLeft: 5;
            readonly UpRight: 9;
            readonly DownLeft: 6;
            readonly DownRight: 10;
            readonly UpDownLeft: 7;
            readonly UpDownRight: 11;
            readonly UpLeftRight: 13;
            readonly DownLeftRight: 14;
            readonly UpDownLeftRight: 15;
            readonly NoChildren: 16;
            [index: number]: string;
        } = {
            None: 0,
            "0": "None",
            Up: 1,
            "1": "Up",
            Down: 2,
            "2": "Down",
            Left: 4,
            "4": "Left",
            Right: 8,
            "8": "Right",
            UpDown: 3,
            "3": "UpDown",
            LeftRight: 12,
            "12": "LeftRight",
            UpLeft: 5,
            "5": "UpLeft",
            UpRight: 9,
            "9": "UpRight",
            DownLeft: 6,
            "6": "DownLeft",
            DownRight: 10,
            "10": "DownRight",
            UpDownLeft: 7,
            "7": "UpDownLeft",
            UpDownRight: 11,
            "11": "UpDownRight",
            UpLeftRight: 13,
            "13": "UpLeftRight",
            DownLeftRight: 14,
            "14": "DownLeftRight",
            UpDownLeftRight: 15,
            "15": "UpDownLeftRight",
            NoChildren: 16,
            "16": "NoChildren"
        };
        interface FlowGraphNode {
            id: number;
            flowNode: FlowNode;
            edges: FlowGraphEdge[];
            text: string;
            lane: number;
            endLane: number;
            level: number;
            circular: boolean | "circularity";
        }
        interface FlowGraphEdge {
            source: FlowGraphNode;
            target: FlowGraphNode;
        }
        const hasAntecedentFlags = FlowFlags.Assignment |
            FlowFlags.Condition |
            FlowFlags.SwitchClause |
            FlowFlags.ArrayMutation |
            FlowFlags.Call |
            FlowFlags.ReduceLabel;
        const hasNodeFlags = FlowFlags.Start |
            FlowFlags.Assignment |
            FlowFlags.Call |
            FlowFlags.Condition |
            FlowFlags.ArrayMutation;
        const links: Record<number, FlowGraphNode> = Object.create(/*o*/ null); // eslint-disable-line no-restricted-syntax
        const nodes: FlowGraphNode[] = [];
        const edges: FlowGraphEdge[] = [];
        const root = buildGraphNode(flowNode, new Set());
        for (const node of nodes) {
            node.text = renderFlowNode(node.flowNode, node.circular);
            computeLevel(node);
        }
        const height = computeHeight(root);
        const columnWidths = computeColumnWidths(height);
        computeLanes(root, 0);
        return renderGraph();
        function isFlowSwitchClause(f: FlowNode): f is FlowSwitchClause {
            return !!(f.flags & FlowFlags.SwitchClause);
        }
        function hasAntecedents(f: FlowNode): f is FlowLabel & {
            antecedent: FlowNode[];
        } {
            return !!(f.flags & FlowFlags.Label) && !!(checkedCompilerLayout(f, checked_isCompilerFlowLabel)).antecedent;
        }
        function hasAntecedent(f: FlowNode): f is FlowNode & {
            antecedent: FlowNode;
        } {
            return !!(f.flags & hasAntecedentFlags);
        }
        function hasNode(f: FlowNode): f is FlowNode & {
            node: Node | undefined;
        } {
            return !!(f.flags & hasNodeFlags);
        }
        function getChildren(node: FlowGraphNode) {
            const children: FlowGraphNode[] = [];
            for (const edge of node.edges) {
                if (edge.source === node) {
                    children.push(edge.target);
                }
            }
            return children;
        }
        function getParents(node: FlowGraphNode) {
            const parents: FlowGraphNode[] = [];
            for (const edge of node.edges) {
                if (edge.target === node) {
                    parents.push(edge.source);
                }
            }
            return parents;
        }
        function buildGraphNode(flowNode: FlowNode, seen: Set<FlowNode>): FlowGraphNode {
            const id = getDebugFlowNodeId(flowNode);
            let graphNode = links[id];
            if (graphNode && seen.has(flowNode)) {
                graphNode.circular = true;
                graphNode = {
                    id: -1,
                    flowNode,
                    edges: [],
                    text: "",
                    lane: -1,
                    endLane: -1,
                    level: -1,
                    circular: "circularity",
                };
                nodes.push(graphNode);
                return graphNode;
            }
            seen.add(flowNode);
            if (!graphNode) {
                links[id] = graphNode = { id, flowNode, edges: [], text: "", lane: -1, endLane: -1, level: -1, circular: false };
                nodes.push(graphNode);
                if (hasAntecedents(flowNode)) {
                    for (const antecedent of flowNode.antecedent) {
                        buildGraphEdge(graphNode, antecedent, seen);
                    }
                }
                else if (hasAntecedent(flowNode)) {
                    buildGraphEdge(graphNode, flowNode.antecedent, seen);
                }
            }
            seen.delete(flowNode);
            return graphNode;
        }
        function buildGraphEdge(source: FlowGraphNode, antecedent: FlowNode, seen: Set<FlowNode>) {
            const target = buildGraphNode(antecedent, seen);
            const edge: FlowGraphEdge = { source, target };
            edges.push(edge);
            source.edges.push(edge);
            target.edges.push(edge);
        }
        function computeLevel(node: FlowGraphNode): number {
            if (node.level !== -1) {
                return node.level;
            }
            let level = 0;
            for (const parent of getParents(node)) {
                level = Math.max(level, computeLevel(parent) + 1);
            }
            return node.level = level;
        }
        function computeHeight(node: FlowGraphNode): number {
            let height = 0;
            for (const child of getChildren(node)) {
                height = Math.max(height, computeHeight(child));
            }
            return height + 1;
        }
        function computeColumnWidths(height: number) {
            const columns: number[] = fill(Array(height), 0);
            for (const node of nodes) {
                columns[node.level] = Math.max(columns[node.level], node.text.length);
            }
            return columns;
        }
        function computeLanes(node: FlowGraphNode, lane: number) {
            if (node.lane === -1) {
                node.lane = lane;
                node.endLane = lane;
                const children = getChildren(node);
                for (let i = 0; i < children.length; i++) {
                    if (i > 0)
                        lane++;
                    const child = children[i];
                    computeLanes(child, lane);
                    if (child.endLane > node.endLane) {
                        lane = child.endLane;
                    }
                }
                node.endLane = lane;
            }
        }
        function getHeader(flags: FlowFlags) {
            if (flags & FlowFlags.Start)
                return "Start";
            if (flags & FlowFlags.BranchLabel)
                return "Branch";
            if (flags & FlowFlags.LoopLabel)
                return "Loop";
            if (flags & FlowFlags.Assignment)
                return "Assignment";
            if (flags & FlowFlags.TrueCondition)
                return "True";
            if (flags & FlowFlags.FalseCondition)
                return "False";
            if (flags & FlowFlags.SwitchClause)
                return "SwitchClause";
            if (flags & FlowFlags.ArrayMutation)
                return "ArrayMutation";
            if (flags & FlowFlags.Call)
                return "Call";
            if (flags & FlowFlags.ReduceLabel)
                return "ReduceLabel";
            if (flags & FlowFlags.Unreachable)
                return "Unreachable";
            throw new Error();
        }
        function getNodeText(node: Node) {
            const sourceFile = getSourceFileOfNode(node);
            return getSourceTextOfNodeFromSourceFile(sourceFile, node, /*includeTrivia*/ false);
        }
        function renderFlowNode(flowNode: FlowNode, circular: boolean | "circularity") {
            let text = getHeader(flowNode.flags);
            if (circular) {
                text = `${text}#${getDebugFlowNodeId(flowNode)}`;
            }
            if (isFlowSwitchClause(flowNode)) {
                const clauses: string[] = [];
                const { switchStatement, clauseStart, clauseEnd } = flowNode.node;
                for (let i = clauseStart; i < clauseEnd; i++) {
                    const clause = switchStatement.caseBlock.clauses[i];
                    if (isDefaultClause(clause)) {
                        clauses.push("default");
                    }
                    else {
                        clauses.push(getNodeText(clause.expression));
                    }
                }
                text += ` (${clauses.join(", ")})`;
            }
            else if (hasNode(flowNode)) {
                if (flowNode.node) {
                    text += ` (${getNodeText(flowNode.node)})`;
                }
            }
            return circular === "circularity" ? `Circular(${text})` : text;
        }
        function renderGraph() {
            const columnCount = columnWidths.length;
            const laneCount = maxBy(nodes, 0, n => n.lane) + 1;
            const lanes: string[] = fill(Array(laneCount), "");
            const grid: (FlowGraphNode | undefined)[][] = columnWidths.map(() => Array<FlowGraphNode | undefined>(laneCount));
            const connectors: Connection[][] = columnWidths.map(() => fill(Array<Connection>(laneCount), 0));
            // build connectors
            for (const node of nodes) {
                grid[node.level][node.lane] = node;
                const children = getChildren(node);
                for (let i = 0; i < children.length; i++) {
                    const child = children[i];
                    let connector: Connection = Connection.Right;
                    if (child.lane === node.lane)
                        connector |= Connection.Left;
                    if (i > 0)
                        connector |= Connection.Up;
                    if (i < children.length - 1)
                        connector |= Connection.Down;
                    connectors[node.level][child.lane] |= connector;
                }
                if (children.length === 0) {
                    connectors[node.level][node.lane] |= Connection.NoChildren;
                }
                const parents = getParents(node);
                for (let i = 0; i < parents.length; i++) {
                    const parent = parents[i];
                    let connector: Connection = Connection.Left;
                    if (i > 0)
                        connector |= Connection.Up;
                    if (i < parents.length - 1)
                        connector |= Connection.Down;
                    connectors[node.level - 1][parent.lane] |= connector;
                }
            }
            // fill in missing connectors
            for (let column = 0; column < columnCount; column++) {
                for (let lane = 0; lane < laneCount; lane++) {
                    const left = column > 0 ? connectors[column - 1][lane] : 0;
                    const above = lane > 0 ? connectors[column][lane - 1] : 0;
                    let connector = connectors[column][lane];
                    if (!connector) {
                        if (left & Connection.Right)
                            connector |= Connection.LeftRight;
                        if (above & Connection.Down)
                            connector |= Connection.UpDown;
                        connectors[column][lane] = connector;
                    }
                }
            }
            for (let column = 0; column < columnCount; column++) {
                for (let lane = 0; lane < lanes.length; lane++) {
                    const connector = connectors[column][lane];
                    const fill = connector & Connection.Left ? BoxCharacter.lr : " ";
                    const node = grid[column][lane];
                    if (!node) {
                        if (column < columnCount - 1) {
                            writeLane(lane, repeat(fill, columnWidths[column] + 1));
                        }
                    }
                    else {
                        writeLane(lane, node.text);
                        if (column < columnCount - 1) {
                            writeLane(lane, " ");
                            writeLane(lane, repeat(fill, columnWidths[column] - node.text.length));
                        }
                    }
                    writeLane(lane, getBoxCharacter(connector));
                    writeLane(lane, connector & Connection.Right && column < columnCount - 1 && !grid[column + 1][lane] ? BoxCharacter.lr : " ");
                }
            }
            return `\n${lanes.join("\n")}\n`;
            function writeLane(lane: number, text: string) {
                lanes[lane] += text;
            }
        }
        function getBoxCharacter(connector: Connection) {
            switch (connector) {
                case Connection.UpDown:
                    return BoxCharacter.ud;
                case Connection.LeftRight:
                    return BoxCharacter.lr;
                case Connection.UpLeft:
                    return BoxCharacter.ul;
                case Connection.UpRight:
                    return BoxCharacter.ur;
                case Connection.DownLeft:
                    return BoxCharacter.dl;
                case Connection.DownRight:
                    return BoxCharacter.dr;
                case Connection.UpDownLeft:
                    return BoxCharacter.udl;
                case Connection.UpDownRight:
                    return BoxCharacter.udr;
                case Connection.UpLeftRight:
                    return BoxCharacter.ulr;
                case Connection.DownLeftRight:
                    return BoxCharacter.dlr;
                case Connection.UpDownLeftRight:
                    return BoxCharacter.udlr;
            }
            return " ";
        }
        function fill<T>(array: T[], value: T) {
            if (array.fill) {
                array.fill(value);
            }
            else {
                for (let i = 0; i < array.length; i++) {
                    array[i] = value;
                }
            }
            return array;
        }
        function repeat(ch: string, length: number) {
            if (ch.repeat) {
                return length > 0 ? ch.repeat(length) : "";
            }
            let s = "";
            while (s.length < length) {
                s += ch;
            }
            return s;
        }
    }
    return {
        currentLogLevel,
        isDebugging,
        shouldLog,
        log: log_namespace,
        getAssertionLevel,
        setAssertionLevel,
        shouldAssert,
        fail,
        failBadSyntaxKind,
        assert,
        assertEqual,
        assertLessThan,
        assertLessThanOrEqual,
        assertGreaterThanOrEqual,
        assertIsDefined,
        checkDefined,
        assertEachIsDefined,
        checkEachDefined,
        assertNever,
        assertEachNode,
        assertNode,
        assertNotNode,
        assertOptionalNode,
        assertOptionalToken,
        assertMissingNode,
        type,
        getFunctionName,
        formatSymbol,
        formatEnum,
        formatSyntaxKind,
        formatSnippetKind,
        formatScriptKind,
        formatNodeFlags,
        formatNodeCheckFlags,
        formatModifierFlags,
        formatTransformFlags,
        formatEmitFlags,
        formatSymbolFlags,
        formatTypeFlags,
        formatSignatureFlags,
        formatObjectFlags,
        formatFlowFlags,
        formatRelationComparisonResult,
        formatCheckMode,
        formatSignatureCheckMode,
        formatTypeFacts,
        attachFlowNodeDebugInfo,
        attachNodeArrayDebugInfo,
        enableDebugInfo,
        formatVariance,
        DebugTypeMapper,
        attachDebugPrototypeIfDebug,
        printControlFlowGraph,
        formatControlFlowGraph
    };
})();
