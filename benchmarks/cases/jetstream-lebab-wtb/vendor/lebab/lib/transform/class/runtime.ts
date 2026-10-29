// Checked views of the original class-transform capture values. No nodes are copied.
import type {AstNode} from "../../../../../ast.ts";
import type * as K from "../../../../../types/ast-types/gen/kinds.js";
import {load as loadTypes} from "../../../../ast-types/lib/main.ts";
import {isRecord, readProperty} from "../../../../../webpack.ts";
export type ClassFunction = K.FunctionDeclarationKind | K.FunctionExpressionKind | K.ArrowFunctionExpressionKind;
export interface MethodConfig {
 name?: unknown; methodNode: ClassFunction; fullNode?: AstNode; commentNodes?: AstNode[];
 parent?: AstNode | null; kind?: string; static?: boolean; potentialClass?: unknown;
}
export interface RelatedExpression {node: AstNode; parent: AstNode | null;}
export interface Replacement {node: AstNode | undefined; parent: AstNode | null | undefined; replacements: AstNode[];}
export interface ClassConfig {name: string; fullNode: AstNode; commentNodes: AstNode[]; parent: AstNode | null;}
export interface DescriptorMatch {propertyNode: K.PropertyKind; methodNode: ClassFunction; kind: string;}
export interface MethodMatch {className: string; methodName: unknown; methodNode: AstNode; descriptors: DescriptorMatch[]; static: boolean;}
export interface FunctionProperty extends Omit<K.PropertyKind, "key" | "value"> {key: K.IdentifierKind; value: ClassFunction;}
export function classText(value: unknown): string { if (typeof value !== "string") throw new TypeError("Expected the matched identifier name"); return value; }
export function optionalText(value: unknown): string | undefined { return value === undefined ? value : classText(value); }
export function classNode(value: unknown): AstNode { if (loadTypes().namedTypes.Node.check(value)) return value; throw new TypeError("Expected the matched AST node"); }
export function classExpression(value: unknown): K.ExpressionKind { if (loadTypes().namedTypes.Expression.check(value)) return value; throw new TypeError("Expected the matched expression"); }
export function optionalExpression(value: unknown): K.ExpressionKind | undefined { return value === undefined ? value : classExpression(value); }
export function classFunction(value: unknown): ClassFunction {
 const n = loadTypes().namedTypes;
 if (n.FunctionDeclaration.check(value) || n.FunctionExpression.check(value) || n.ArrowFunctionExpression.check(value)) return value;
 throw new TypeError("Expected the matched function");
}
export function classIdentifier(value: unknown): K.IdentifierKind { if (loadTypes().namedTypes.Identifier.check(value)) return value; throw new TypeError("Expected the matched identifier"); }
export function classVariableDeclaration(value: unknown): K.VariableDeclarationKind { if (loadTypes().namedTypes.VariableDeclaration.check(value)) return value; throw new TypeError("Expected the matched variable declaration"); }
export function classCallStatement(value: unknown): K.ExpressionStatementKind & {expression: K.CallExpressionKind} {
 if (isClassCallStatement(value)) return value;
 throw new TypeError("Expected the matched call statement");
}
export function classObject(value: unknown): K.ObjectExpressionKind { if (loadTypes().namedTypes.ObjectExpression.check(value)) return value; throw new TypeError("Expected the matched object expression"); }
export function classProperties(value: unknown): K.PropertyKind[] {
 if (isClassProperties(value)) return value;
 throw new TypeError("Expected the matched property array");
}
function isClassProperties(value: unknown): value is K.PropertyKind[] { return Array.isArray(value) && value.every((v: unknown) => loadTypes().namedTypes.Property.check(v)); }
export function optionalProperties(value: unknown): K.PropertyKind[] | undefined { return value === undefined ? value : classProperties(value); }
export function functionProperty(value: K.PropertyKind): FunctionProperty {
 if (isFunctionProperty(value)) return value;
 throw new TypeError("Expected the matched method property");
}
function isFunctionProperty(value: K.PropertyKind): value is K.PropertyKind & FunctionProperty {
 const n = loadTypes().namedTypes;
 return n.Identifier.check(value.key) && (n.FunctionExpression.check(value.value) || n.ArrowFunctionExpression.check(value.value));
}
export function descriptorArray(value: unknown): DescriptorMatch[] {
 if (isDescriptorArray(value)) return value;
 throw new TypeError("Expected the matched method descriptors");
}
function isDescriptorArray(value: unknown): value is DescriptorMatch[] {
 return Array.isArray(value) && value.every((v: unknown) => isRecord(v) && loadTypes().namedTypes.Property.check(v.propertyNode) && typeof v.kind === "string" && isRecord(v.methodNode) && (v.methodNode.type === "FunctionExpression" || v.methodNode.type === "ArrowFunctionExpression"));
}
export function methodMatches(value: unknown): MethodMatch[] { if (isMethodMatches(value)) return value; throw new TypeError("Expected the matched method list"); }
function isMethodMatches(value: unknown): value is MethodMatch[] {
 return Array.isArray(value) && value.every((v: unknown) => isRecord(v) && typeof v.className === "string" && typeof v.static === "boolean" && loadTypes().namedTypes.Node.check(v.methodNode) && isDescriptorArray(v.descriptors));
}
export function matchFlag(value: unknown): boolean { if (typeof value !== "boolean") throw new TypeError("Expected the matched static flag"); return value; }
export function relatedExpressions(value: unknown): RelatedExpression[] { if (isRelated(value)) return value; throw new TypeError("Expected the matched inheritance statements"); }
function isRelated(value: unknown): value is RelatedExpression[] { return Array.isArray(value) && value.every((v: unknown) => isRecord(v) && loadTypes().namedTypes.Node.check(v.node) && (v.parent === null || loadTypes().namedTypes.Node.check(v.parent))); }
export function unknownArray(value: unknown): unknown[] { if (isUnknownArray(value)) return value; throw new TypeError("Expected original array"); }
function isUnknownArray(value: unknown): value is unknown[] { return Array.isArray(value); }
export function classBlock(value: unknown): K.BlockStatementKind { if (loadTypes().namedTypes.BlockStatement.check(value)) return value; throw new TypeError("Expected the transformed function body"); }
export function inheritsExpression(value: unknown): K.MemberExpressionKind | K.IdentifierKind { const n=loadTypes().namedTypes; if (n.MemberExpression.check(value) || n.Identifier.check(value)) return value; throw new TypeError("Expected inherits reference"); }
export interface PrototypeMethod {propertyNode: K.PropertyKind; methodName: string; methodNode: ClassFunction; kind: string;}
export function prototypeMethods(value: unknown): PrototypeMethod[] { if (isPrototypeMethods(value)) return value; throw new TypeError("Expected matched prototype methods"); }
function isPrototypeMethods(value: unknown): value is PrototypeMethod[] { return Array.isArray(value) && value.every((v: unknown) => isRecord(v) && typeof v.methodName === "string" && typeof v.kind === "string" && loadTypes().namedTypes.Property.check(v.propertyNode) && isRecord(v.methodNode) && (v.methodNode.type === "FunctionExpression" || v.methodNode.type === "ArrowFunctionExpression")); }

function isClassCallStatement(value: unknown): value is K.ExpressionStatementKind & {expression: K.CallExpressionKind} { return loadTypes().namedTypes.ExpressionStatement.check(value) && loadTypes().namedTypes.CallExpression.check(value.expression); }
