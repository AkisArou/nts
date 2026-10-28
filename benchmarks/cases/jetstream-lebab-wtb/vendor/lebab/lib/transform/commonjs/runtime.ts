// Checked views of values captured by the original CommonJS match patterns.
// Every helper returns the original AST or array; no syntax nodes are copied.
import type * as K from "../../../../../types/ast-types/gen/kinds.js";
import {load as loadTypes} from "../../../../ast-types/lib/main.ts";
export {classExpression, classIdentifier, classNode, classVariableDeclaration} from "../class/runtime.ts";
export function objectPattern(value: unknown): K.ObjectPatternKind {
    if (loadTypes().namedTypes.ObjectPattern.check(value)) return value;
    throw new TypeError("Expected the original matched object pattern");
}
export function literalArray(value: unknown): K.LiteralKind[] {
    if (isLiteralArray(value)) return value;
    throw new TypeError("Expected the original require source literals");
}
function isLiteralArray(value: unknown): value is K.LiteralKind[] {
    return Array.isArray(value) && value.every((item: unknown) => loadTypes().namedTypes.Literal.check(item));
}
export function matchedFunctionDeclaration(value: unknown): K.FunctionDeclarationKind {
    if (loadTypes().namedTypes.FunctionDeclaration.check(value)) return value;
    throw new TypeError("Expected the original mutated function declaration");
}
export function matchedClassDeclaration(value: unknown): K.ClassDeclarationKind {
    if (loadTypes().namedTypes.ClassDeclaration.check(value)) return value;
    throw new TypeError("Expected the original mutated class declaration");
}
export function matchedArray(value: unknown): unknown[] {
    if (Array.isArray(value)) return value;
    throw new TypeError("Expected the original matched AST array");
}
