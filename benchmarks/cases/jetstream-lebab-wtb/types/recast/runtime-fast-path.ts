// Original Recast FastPath state, with concrete callback and token layouts.
import type * as K from '../ast-types/gen/kinds.js';
export interface FastPathPosition { line: number; column: number; token?: number; }
export interface FastPathLocation {
    start: FastPathPosition;
    end: FastPathPosition;
    tokens?: unknown[];
}
export interface FastPathToken {
    value?: unknown;
    loc: FastPathLocation;
}
export interface RuntimeFastPath {
    stack: unknown[];
    copy(): RuntimeFastPath;
    getName(): PropertyKey | null | undefined;
    getValue(...ignored: unknown[]): unknown;
    valueIsDuplicate(): boolean;
    getNode(count?: number): K.NodeKind | null;
    getParentNode(count?: number): K.NodeKind | null;
    getRootValue(): unknown;
    call<T>(callback: (path: RuntimeFastPath) => T, ...names: PropertyKey[]): T;
    each(callback: (path: RuntimeFastPath) => unknown, ...names: PropertyKey[]): void;
    map<T>(callback: (path: RuntimeFastPath, index: number) => T, ...names: PropertyKey[]): T[];
    hasParens(): boolean;
    getPrevToken(node?: K.NodeKind | null): FastPathToken | null;
    getNextToken(node?: K.NodeKind | null): FastPathToken | null;
    needsParens(assumeExpressionContext?: boolean): boolean;
    canBeFirstInStatement(): boolean;
    firstInStatement(): boolean;
}
export interface FastPathConstructor {
    new(value: unknown): RuntimeFastPath;
    from(value: unknown): RuntimeFastPath;
}
