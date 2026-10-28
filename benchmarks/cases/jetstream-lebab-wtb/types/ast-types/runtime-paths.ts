// Layouts of the original ast-types 0.16.1 Path, NodePath and Scope objects.
import type * as K from './gen/kinds.js';
export type PathName = PropertyKey | null | undefined;
export interface RuntimePath {
    value: unknown;
    parentPath: RuntimePath | null;
    name: PathName;
    __childCache: Record<PropertyKey, RuntimePath> | null;
    constructor: PathConstructor;
    // NodePath adds these memoized accessors; plain Path instances omit them.
    node?: K.NodeKind | null;
    parent?: RuntimePath | null;
    scope?: RuntimeScope | null;
    prune?: (...args: unknown[]) => RuntimePath | null;
    getValueProperty(name: PropertyKey): unknown;
    get(...names: PropertyKey[]): RuntimePath;
    each(callback: (this: unknown, path: RuntimePath) => unknown, context?: unknown): void;
    map<T>(callback: (this: unknown, path: RuntimePath) => T, context?: unknown): T[];
    filter(callback: (this: unknown, path: RuntimePath) => unknown, context?: unknown): RuntimePath[];
    shift(): unknown;
    unshift(...args: unknown[]): number;
    push(...args: unknown[]): number;
    pop(): unknown;
    insertAt(index: PathName, ...args: unknown[]): RuntimePath;
    insertBefore(...args: unknown[]): RuntimePath;
    insertAfter(...args: unknown[]): RuntimePath;
    replace(replacement?: unknown, ...args: unknown[]): RuntimePath[];
}
export interface PathConstructor {
    new(value: unknown, parentPath?: RuntimePath | null, name?: PathName): RuntimePath;
    prototype: RuntimePath;
}
export interface RuntimeNodePath extends RuntimePath {
    constructor: NodePathConstructor;
    node?: K.NodeKind | null;
    parent?: RuntimePath | null;
    scope?: RuntimeScope | null;
    get(...names: PropertyKey[]): RuntimeNodePath;
    prune(...args: unknown[]): RuntimePath | null;
    _computeNode(): K.NodeKind | null;
    _computeParent(): RuntimePath | null;
    _computeScope(): RuntimeScope | null;
    needsParens(assumeExpressionContext?: boolean): boolean;
    canBeFirstInStatement(): boolean;
    firstInStatement(): boolean;
}
export interface NodePathConstructor extends PathConstructor {
    new(value: unknown, parentPath?: RuntimePath | null, name?: PathName): RuntimeNodePath;
    prototype: RuntimeNodePath;
}
export type ScopeBindings = Record<PropertyKey, RuntimePath[] | K.IdentifierKind>;
export interface RuntimeScope {
    path: RuntimePath;
    node: K.NodeKind;
    isGlobal: boolean;
    depth: number;
    parent: RuntimeScope | null;
    bindings: ScopeBindings;
    types: ScopeBindings;
    didScan: boolean;
    declares(name: string): boolean;
    declaresType(name: string): boolean;
    declareTemporary(prefix?: string): K.IdentifierKind;
    injectTemporary(identifier?: K.IdentifierKind, init?: K.ExpressionKind | null): K.IdentifierKind;
    scan(force?: boolean): void;
    getBindings(): ScopeBindings;
    getTypes(): ScopeBindings;
    lookup(name: string): RuntimeScope | null;
    lookupType(name: string): RuntimeScope | null;
    getGlobalScope(): RuntimeScope;
}
export interface ScopeConstructor {
    new(path: RuntimePath, parentScope?: RuntimeScope | null): RuntimeScope;
    prototype: RuntimeScope;
    isEstablishedBy(node: unknown): boolean;
}
