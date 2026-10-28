import type * as K from "../../../../../types/ast-types/gen/kinds.js";
import {load as loadTypes} from "../../../../ast-types/lib/main.ts";
export {classText, classExpression} from "../class/runtime.ts";
export function searchArgument(value: unknown): K.ExpressionKind | K.SpreadElementKind {
    const n = loadTypes().namedTypes;
    if (n.Expression.check(value) || n.SpreadElement.check(value)) return value;
    throw new TypeError("Expected the original indexOf argument");
}
