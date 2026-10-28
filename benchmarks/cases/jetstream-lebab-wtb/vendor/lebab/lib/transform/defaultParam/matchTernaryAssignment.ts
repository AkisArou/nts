import type {AstNode} from "../../../../../ast.ts";
import type * as K from "../../../../../types/ast-types/gen/kinds.js";
import type {namedTypes as N} from "../../../../../types/ast-types/gen/namedTypes.js";
import type {FunctionNode} from "../../../../../escope-types.ts";
import {classText, optionalText, classNode, classBlock, classFunction, classExpression, classIdentifier, loopMatch, forLoop, programNode, assignmentPattern, warningArgs, strings, type LoopMatch, type DefaultInfo} from "../runtime-transforms.ts";
import type {Constructor, Descriptor} from "../../../../../webpack.ts";
// Exact module body from JetStream 3.0 ./node_modules/lebab/lib/transform/defaultParam/matchTernaryAssignment.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord, record, readProperty, symbolValue, primitiveMethod, hasEsModuleFlag} from "../../../../../webpack.ts";
import {load as load0} from "../../../../f-matches/index.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lebab/lib/transform/defaultParam/matchTernaryAssignment.js");
  return value;
 }
 return initialize();
}
function isExport(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> {
 return isRecord(value) && value.__esModule === true && value["default"] !== undefined;
}
function initialize() {
const exports: { __esModule?: true; "default"?: typeof _default; } = {};
let module = {exports};
cache = module;


"use strict";


Object.defineProperty(exports, "__esModule", ({
  value: true
}));
exports["default"] = _default;
var _fMatches = load0();
var matchTernaryAssignment = (0, _fMatches.matches)({
  type: 'ExpressionStatement',
  expression: {
    type: 'AssignmentExpression',
    left: {
      type: 'Identifier',
      name: (0, _fMatches.extractAny)('name')
    },
    operator: '=',
    right: {
      type: 'ConditionalExpression',
      test: {
        type: 'Identifier',
        name: (0, _fMatches.extractAny)('name2')
      },
      consequent: {
        type: 'Identifier',
        name: (0, _fMatches.extractAny)('name3')
      },
      alternate: (0, _fMatches.extractAny)('value')
    }
  }
});

/**
 * Matches: <name> = <name> ? <name> : <value>;
 *
 * When node matches returns the extracted fields:
 *
 * - name
 * - value
 * - node (the entire node)
 *
 * @param {Object} node
 * @return {Object}
 */
function _default(node: AstNode) {
  var _ref = matchTernaryAssignment(node) || {},
    name = _ref.name,
    name2 = _ref.name2,
    name3 = _ref.name3,
    value = _ref.value;
  if (name && name === name2 && name === name3) {
    return {
      name: classText(name),
      value: value,
      node: node
    };
  }
}

/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected the initialized ES module flag");
if (!exportsReady(exports, ["default"])) throw new TypeError("Incomplete bundled exports");
return exports;
}
