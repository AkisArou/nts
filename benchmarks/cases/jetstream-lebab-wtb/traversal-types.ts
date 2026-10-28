import {isRecord, readProperty} from "./webpack.ts";

export type SharedSyntaxName = "AssignmentExpression" | "AssignmentPattern" | "ArrayExpression" | "ArrayPattern" | "ArrowFunctionExpression" | "AwaitExpression" | "BlockStatement" | "BinaryExpression" | "BreakStatement" | "CallExpression" | "CatchClause" | "ClassBody" | "ClassDeclaration" | "ClassExpression" | "ComprehensionBlock" | "ComprehensionExpression" | "ConditionalExpression" | "ContinueStatement" | "DebuggerStatement" | "DirectiveStatement" | "DoWhileStatement" | "EmptyStatement" | "ExportAllDeclaration" | "ExportDefaultDeclaration" | "ExportNamedDeclaration" | "ExportSpecifier" | "ExpressionStatement" | "ForStatement" | "ForInStatement" | "ForOfStatement" | "FunctionDeclaration" | "FunctionExpression" | "GeneratorExpression" | "Identifier" | "IfStatement" | "ImportExpression" | "ImportDeclaration" | "ImportDefaultSpecifier" | "ImportNamespaceSpecifier" | "ImportSpecifier" | "Literal" | "LabeledStatement" | "LogicalExpression" | "MemberExpression" | "MetaProperty" | "MethodDefinition" | "ModuleSpecifier" | "NewExpression" | "ObjectExpression" | "ObjectPattern" | "Program" | "Property" | "RestElement" | "ReturnStatement" | "SequenceExpression" | "SpreadElement" | "Super" | "SwitchStatement" | "SwitchCase" | "TaggedTemplateExpression" | "TemplateElement" | "TemplateLiteral" | "ThisExpression" | "ThrowStatement" | "TryStatement" | "UnaryExpression" | "UpdateExpression" | "VariableDeclaration" | "VariableDeclarator" | "WhileStatement" | "WithStatement" | "YieldExpression";
export type SyntaxTable = Record<string, string> & {[Name in SharedSyntaxName]: Name};
export type TraversalPath = string | (string | number)[];
export interface TraversalVisitor {
    enter?: unknown;
    leave?: unknown;
    keys?: Record<string, string[]>;
    fallback?: "iteration" | ((node: unknown) => string[]);
}
export interface TraversalReference {
    parent: unknown;
    key: string | number;
    replace(node: unknown): void;
    remove(): boolean;
}
export interface TraversalElement {
    node?: unknown;
    path?: TraversalPath | null;
    wrap?: string | null;
    ref?: TraversalReference | null;
}
export interface TraversalController {
    path(): (string | number | null | undefined)[] | null;
    type(): unknown;
    parents(): unknown[];
    current(): unknown;
    notify(flag: unknown): void;
    skip(): void;
    break(): void;
    remove(): void;
    traverse(root: unknown, visitor: TraversalVisitor): void;
    replace(root: unknown, visitor: TraversalVisitor): unknown;
}
export interface TraversalModule {
    version?: string;
    Syntax: SyntaxTable;
    VisitorKeys: Record<string, string[]>;
    VisitorOption: {Break: object; Skip: object; Remove: object};
    Controller: new () => TraversalController;
    traverse(root: unknown, visitor: TraversalVisitor): void;
    replace(root: unknown, visitor: TraversalVisitor): unknown;
    attachComments(tree: unknown, comments: readonly unknown[], tokens: readonly RangedValue[]): unknown;
    cloneEnvironment(): TraversalModule;
}
export interface IndexRange {0: number; 1: number;}
export interface RangedValue {range: IndexRange;}
export interface RangedComment extends RangedValue {extendedRange?: [number, number];}
export interface ExtendedComment extends RangedValue {extendedRange: [number, number];}

export function stringKey(value: unknown): string {
    if (typeof value !== "string") throw new TypeError("Expected the original AST node type");
    return value;
}
export function numericReference<T extends TraversalReference>(value: T): T & {key: number} {
    if (!hasNumericReference(value)) throw new TypeError("Expected an array element reference");
    return value;
}
function hasNumericReference<T extends TraversalReference>(value: T): value is T & {key: number} {
    return typeof value.key === "number";
}
type TraversalCallback = (this: TraversalController, node: unknown, parent: unknown) => unknown;
function isTraversalCallback(value: unknown): value is TraversalCallback { return typeof value === "function"; }
export function traversalCallback(value: unknown): TraversalCallback {
    if (!isTraversalCallback(value)) throw new TypeError("Expected a traversal callback");
    return value;
}
function hasIndexRange(value: unknown): value is IndexRange {
    return isRecord(value) && typeof value[0] === "number" && typeof value[1] === "number";
}
function isRangedValue(value: unknown): value is RangedValue {
    return isRecord(value) && hasIndexRange(value.range);
}
export function rangedValue(value: unknown): RangedValue {
    if (!isRangedValue(value)) throw new TypeError("Expected AST range information");
    return value;
}
function isRangedComment(value: unknown): value is RangedComment {
    return isRangedValue(value) && (readProperty(value, "extendedRange") === undefined || isExtendedComment(value));
}
export function rangedComment(value: unknown): RangedComment {
    if (!isRangedComment(value)) throw new TypeError("Expected comment range information");
    return value;
}
function isExtendedComment(value: unknown): value is ExtendedComment {
    if (!isRangedValue(value)) return false;
    const range = readProperty(value, "extendedRange");
    return Array.isArray(range) && range.length === 2 && typeof range[0] === "number" && typeof range[1] === "number";
}
export function extendedComment(value: unknown): ExtendedComment {
    if (!isExtendedComment(value)) throw new TypeError("Expected the completed comment range");
    return value;
}
function isUnknownArray(value: unknown): value is unknown[] { return Array.isArray(value); }
export function commentArray(value: unknown): unknown[] {
    if (!isUnknownArray(value)) throw new TypeError("Expected the original comment array");
    return value;
}
export function isTraversalModule(value: unknown): value is TraversalModule {
    return isRecord(value) && isRecord(value.Syntax) && isRecord(value.VisitorKeys)
        && isRecord(value.VisitorOption) && typeof value.Controller === "function"
        && typeof value.traverse === "function" && typeof value.replace === "function"
        && typeof value.attachComments === "function" && typeof value.cloneEnvironment === "function";
}
