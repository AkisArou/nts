import type {AstNode} from "../../../../../ast.ts";
import type * as K from "../../../../../types/ast-types/gen/kinds.js";
import {classText, optionalText, classNode, classExpression, optionalExpression, classFunction, classIdentifier, classVariableDeclaration, classCallStatement, classObject, classProperties, optionalProperties, functionProperty, descriptorArray, methodMatches, matchFlag, relatedExpressions, unknownArray, type ClassFunction, type MethodConfig, type RelatedExpression, type Replacement, type ClassConfig} from "./runtime.ts";
import type {Constructor, Descriptor} from "../../../../../webpack.ts";
// Exact module body from JetStream 3.0 ./node_modules/lebab/lib/transform/class/matchPrototypeObjectAssignment.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord, record, readProperty, symbolValue, primitiveMethod, hasEsModuleFlag} from "../../../../../webpack.ts";
import {load as load0} from "../../../../f-matches/index.ts";
import {load as load1} from "./isFunctionProperty.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lebab/lib/transform/class/matchPrototypeObjectAssignment.js");
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
var _isFunctionProperty = _interopRequireDefault(load1());
function _interopRequireDefault<T extends {__esModule: true}>(obj: T): T;
function _interopRequireDefault<T>(obj: T): {default: T};
function _interopRequireDefault(obj: unknown) { return obj && readProperty(obj, "__esModule") ? obj : { "default": obj }; }
var matchPrototypeObjectAssignment = (0, _fMatches.matches)({
  type: 'ExpressionStatement',
  expression: {
    type: 'AssignmentExpression',
    left: {
      type: 'MemberExpression',
      computed: false,
      object: {
        type: 'Identifier',
        name: (0, _fMatches.extractAny)('className')
      },
      property: {
        type: 'Identifier',
        name: 'prototype'
      }
    },
    operator: '=',
    right: {
      type: 'ObjectExpression',
      properties: (0, _fMatches.extract)('properties', function (props: unknown) {
        return unknownArray(props).every((_isFunctionProperty["default"]!));
      })
    }
  }
});

/**
 * Matches: <className>.prototype = {
 *              <methodName>: <methodNode>,
 *              ...
 *          };
 *
 * When node matches returns the extracted fields:
 *
 * - className
 * - methods
 *     - propertyNode
 *     - methodName
 *     - methodNode
 *     - kind
 *
 * @param  {Object} node
 * @return {Object}
 */
function _default(node: AstNode) {
  var _matchPrototypeObject = matchPrototypeObjectAssignment(node),
    className = optionalText(readProperty(_matchPrototypeObject, "className")),
    properties = optionalProperties(readProperty(_matchPrototypeObject, "properties"));
  if (className) {
    return {
      className: className,
      methods: properties!.map(function (prop) {
        return {
          propertyNode: prop,
          methodName: functionProperty(prop).key.name,
          methodNode: functionProperty(prop).value,
          kind: prop.kind
        };
      })
    };
  }
}

/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected the initialized ES module flag");
if (!exportsReady(exports, ["default"])) throw new TypeError("Incomplete bundled exports");
return exports;
}
