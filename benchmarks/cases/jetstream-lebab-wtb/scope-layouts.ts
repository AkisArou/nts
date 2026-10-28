import {isRecord} from "./webpack.ts";
import type {AstNode} from "./ast.ts";
import type {namedTypes as N} from "./types/ast-types/gen/namedTypes.js";
import type {ScopeDeclarator} from "./escope-types.ts";

export function objectPrototype(value: unknown): object | null {
    if (value === null || isRecord(value)) return value;
    throw new TypeError("Expected the original prototype object");
}
interface ScopeBody {body: unknown[];}
function isScopeBody(value: unknown): value is ScopeBody {
    return isRecord(value) && Array.isArray(value.body);
}
export function scopeBody(value: unknown): ScopeBody {
    if (!isScopeBody(value)) throw new TypeError("Expected the original statement body");
    return value;
}
export function variableDeclaration(value: AstNode): N.VariableDeclaration {
    if (value.type !== "VariableDeclaration") throw new TypeError("Expected the original variable declaration");
    return value;
}
export function declaratorView(value: N.VariableDeclaration["declarations"][number]): ScopeDeclarator {
    return value;
}
