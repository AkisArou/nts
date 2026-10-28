// Checked views of captures produced by the original transform patterns.
import type {AstNode} from "../../../../ast.ts";
import type {namedTypes as N} from "../../../../types/ast-types/gen/namedTypes.js";
import type * as K from "../../../../types/ast-types/gen/kinds.js";
import {load as loadTypes} from "../../../ast-types/lib/main.ts";

export function matchedFunction(value: unknown): N.FunctionExpression {
  if (loadTypes().namedTypes.FunctionExpression.check(value)) return value;
  throw new TypeError("Expected the matched function expression");
}
export function matchedMember(value: unknown): K.MemberExpressionKind {
  if (loadTypes().namedTypes.MemberExpression.check(value)) return value;
  throw new TypeError("Expected the matched member expression");
}
export function arrowFunction(value: AstNode): N.ArrowFunctionExpression {
  if (value.type === "ArrowFunctionExpression") return value;
  throw new TypeError("Expected the matched arrow function");
}
export function variableDeclarator(value: AstNode): N.VariableDeclarator {
  if (value.type === "VariableDeclarator") return value;
  throw new TypeError("Expected the original variable declarator");
}
