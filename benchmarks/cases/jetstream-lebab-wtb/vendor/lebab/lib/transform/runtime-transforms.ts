// Finite views of values already matched by the original transform patterns.
import type {AstNode} from "../../../../ast.ts";
import type {FunctionNode} from "../../../../escope-types.ts";
import type * as K from "../../../../types/ast-types/gen/kinds.js";
import type {namedTypes as N} from "../../../../types/ast-types/gen/namedTypes.js";
import {load as loadTypes} from "../../../ast-types/lib/main.ts";
import {isRecord, readProperty} from "../../../../webpack.ts";
export {classText, optionalText, classNode, classBlock, classFunction, classExpression, classIdentifier} from "./class/runtime.ts";
export interface LoopMatch {body: N.BlockStatement; item: N.Identifier; index: N.Identifier; array: K.ExpressionKind; itemKind: string; indexKind: string;}
export function loopMatch(value: unknown): LoopMatch | false | undefined {
 if (!value) return value === undefined ? undefined : false;
 if (!isLoopMatch(value)) throw new TypeError("Expected the original matched for-loop");
 return value;
}
function isLoopMatch(value: unknown): value is LoopMatch {
 const n=loadTypes().namedTypes;
 return isRecord(value) && n.BlockStatement.check(value.body) && n.Identifier.check(value.item) && n.Identifier.check(value.index) && n.Expression.check(value.array) && typeof value.itemKind === "string" && typeof value.indexKind === "string";
}
export function forLoop(value: AstNode): N.ForStatement { if (value.type!=="ForStatement") throw new TypeError("Expected the matched for-loop");return value; }
export function programNode(value: unknown): N.Program { if (loadTypes().namedTypes.Program.check(value)) return value; throw new TypeError("Expected the parsed program"); }
export function assignmentPattern(value: unknown): N.AssignmentPattern { if (loadTypes().namedTypes.AssignmentPattern.check(value)) return value; throw new TypeError("Expected the original assignment pattern"); }
export function warningArgs(value: unknown[]): [AstNode,string,string] { if (isWarningArgs(value)) return value; throw new TypeError("Expected the original warning arguments"); }
function isWarningArgs(value: unknown[]): value is [AstNode,string,string] {return value.length===3 && loadTypes().namedTypes.Node.check(value[0]) && typeof value[1]==="string" && typeof value[2]==="string";}
export function strings(value: string[]): string[] {return value;}
export interface DefaultInfo {name: string; value: unknown; node: AstNode;}
