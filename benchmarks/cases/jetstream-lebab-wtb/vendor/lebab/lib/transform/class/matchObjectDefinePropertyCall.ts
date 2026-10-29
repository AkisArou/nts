import type {AstNode} from "../../../../../ast.ts";
import type * as K from "../../../../../types/ast-types/gen/kinds.js";
import {classText, optionalText, classNode, classExpression, optionalExpression, classFunction, classIdentifier, classVariableDeclaration, classCallStatement, classObject, classProperties, optionalProperties, functionProperty, descriptorArray, methodMatches, matchFlag, relatedExpressions, unknownArray, type ClassFunction, type MethodConfig, type RelatedExpression, type Replacement, type ClassConfig} from "./runtime.ts";
import type {Constructor, Descriptor} from "../../../../../webpack.ts";
// Exact module body from JetStream 3.0 ./node_modules/lebab/lib/transform/class/matchObjectDefinePropertyCall.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord, record, readProperty, symbolValue, primitiveMethod, hasEsModuleFlag} from "../../../../../webpack.ts";
import {load as load0} from "../../../../f-matches/index.ts";
import {load as load1} from "./isFunctionProperty.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lebab/lib/transform/class/matchObjectDefinePropertyCall.js");
  return value;
 }
 return initialize();
}
function isExport(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> {
 return isRecord(value) && value.__esModule === true && value["default"] !== undefined && value["isAccessorDescriptor"] !== undefined;
}
function initialize() {
const exports: { __esModule?: true; "default"?: typeof _default; "isAccessorDescriptor"?: typeof isAccessorDescriptor; } = {};
let module = {exports};
cache = module;


"use strict";


Object.defineProperty(exports, "__esModule", ({
  value: true
}));
exports["default"] = _default;
exports.isAccessorDescriptor = isAccessorDescriptor;
var _fMatches = load0();
var _isFunctionProperty = _interopRequireDefault(load1());
function _interopRequireDefault<T extends {__esModule: true}>(obj: T): T;
function _interopRequireDefault<T>(obj: T): {default: T};
function _interopRequireDefault(obj: unknown) { return obj && readProperty(obj, "__esModule") ? obj : { "default": obj }; }
var matchObjectDefinePropertyCallOnPrototype = (0, _fMatches.matches)({
  type: 'ExpressionStatement',
  expression: {
    type: 'CallExpression',
    callee: {
      type: 'MemberExpression',
      computed: false,
      object: {
        type: 'Identifier',
        name: 'Object'
      },
      property: {
        type: 'Identifier',
        name: 'defineProperty'
      }
    },
    arguments: [{
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
    }, {
      type: 'Literal',
      value: (0, _fMatches.extractAny)('methodName')
    }, {
      type: 'ObjectExpression',
      properties: (0, _fMatches.extractAny)('properties')
    }]
  }
});
var matchObjectDefinePropertyCall = (0, _fMatches.matches)({
  type: 'ExpressionStatement',
  expression: {
    type: 'CallExpression',
    callee: {
      type: 'MemberExpression',
      computed: false,
      object: {
        type: 'Identifier',
        name: 'Object'
      },
      property: {
        type: 'Identifier',
        name: 'defineProperty'
      }
    },
    arguments: [{
      type: 'Identifier',
      name: (0, _fMatches.extractAny)('className')
    }, {
      type: 'Literal',
      value: (0, _fMatches.extractAny)('methodName')
    }, {
      type: 'ObjectExpression',
      properties: (0, _fMatches.extractAny)('properties')
    }]
  }
});
function isAccessorDescriptor(node: K.PropertyKind) {
  return (0, _isFunctionProperty["default"])(node) && (classIdentifier(node.key).name === 'get' || classIdentifier(node.key).name === 'set');
}

/**
 * Matches: Object.defineProperty(<className>.prototype, "<methodName>", {
 *              <kind>: <methodNode>,
 *              ...
 *          })
 *
 * When node matches returns the extracted fields:
 *
 * - className
 * - methodName
 * - descriptors:
 *     - propertyNode
 *     - methodNode
 *     - kind
 *
 * @param  {Object} node
 * @return {Object}
 */
function _default(node: AstNode) {
  var _matchObjectDefinePro = matchObjectDefinePropertyCallOnPrototype(node),
    className = optionalText(readProperty(_matchObjectDefinePro, "className")),
    methodName = readProperty(_matchObjectDefinePro, "methodName"),
    properties = optionalProperties(readProperty(_matchObjectDefinePro, "properties"));
  var isStatic = false;
  if (!className) {
    var _matchObjectDefinePro2 = matchObjectDefinePropertyCall(node);
    className = optionalText(readProperty(_matchObjectDefinePro2, "className"));
    methodName = readProperty(_matchObjectDefinePro2, "methodName");
    properties = optionalProperties(readProperty(_matchObjectDefinePro2, "properties"));
    isStatic = true;
  }
  if (className) {
    return {
      className: className,
      methodName: methodName,
      descriptors: properties!.filter(isAccessorDescriptor).map(function (prop) {
        return {
          propertyNode: prop,
          methodNode: functionProperty(prop).value,
          kind: functionProperty(prop).key.name
        };
      }),
      "static": isStatic
    };
  }
}

/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected the initialized ES module flag");
if (!exportsReady(exports, ["default","isAccessorDescriptor"])) throw new TypeError("Incomplete bundled exports");
return exports;
}
