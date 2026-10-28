import type {AstNode} from "../../../../../ast.ts";
import type * as K from "../../../../../types/ast-types/gen/kinds.js";
import {classText, optionalText, classNode, classExpression, optionalExpression, classFunction, classIdentifier, classVariableDeclaration, classCallStatement, classObject, classProperties, optionalProperties, functionProperty, descriptorArray, methodMatches, matchFlag, relatedExpressions, unknownArray, type ClassFunction, type MethodConfig, type RelatedExpression, type Replacement, type ClassConfig} from "./runtime.ts";
import type {Constructor, Descriptor} from "../../../../../webpack.ts";
// Exact module body from JetStream 3.0 ./node_modules/lebab/lib/transform/class/matchObjectDefinePropertiesCall.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord, record, readProperty, symbolValue, primitiveMethod, hasEsModuleFlag} from "../../../../../webpack.ts";
import {load as load0} from "../../../../f-matches/index.ts";
import {load as load1} from "./matchObjectDefinePropertyCall.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lebab/lib/transform/class/matchObjectDefinePropertiesCall.js");
  return value;
 }
 return initialize();
}
function isExport(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> {
 return isRecord(value) && value.__esModule === true && value["default"] !== undefined && value["matchDefinedProperties"] !== undefined;
}
function initialize() {
const exports: { __esModule?: true; "default"?: typeof _default; "matchDefinedProperties"?: typeof matchDefinedProperties; } = {};
let module = {exports};
cache = module;


"use strict";


Object.defineProperty(exports, "__esModule", ({
  value: true
}));
exports["default"] = _default;
exports.matchDefinedProperties = void 0;
var _fMatches = load0();
var _matchObjectDefinePropertyCall = load1();
var matchObjectDefinePropertiesCallOnPrototype = (0, _fMatches.matches)({
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
        name: 'defineProperties'
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
      type: 'ObjectExpression',
      properties: (0, _fMatches.extractAny)('methods')
    }]
  }
});
var matchObjectDefinePropertiesCall = (0, _fMatches.matches)({
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
        name: 'defineProperties'
      }
    },
    arguments: [{
      type: 'Identifier',
      name: (0, _fMatches.extractAny)('className')
    }, {
      type: 'ObjectExpression',
      properties: (0, _fMatches.extractAny)('methods')
    }]
  }
});
var matchDefinedProperties = (0, _fMatches.matches)({
  type: 'Property',
  key: {
    type: 'Identifier',
    name: (0, _fMatches.extractAny)('methodName')
  },
  computed: false,
  value: {
    type: 'ObjectExpression',
    properties: (0, _fMatches.extractAny)('properties')
  }
});

/**
 * Matches: Object.defineProperties(<className>.prototype, {
 *              <methodName>: {
 *                <kind>: <methodNode>,
 *              }
 *              ...
 *          })
 *
 * When node matches returns an array of objects with the extracted fields for each method:
 *
 * [{
 *   - className
 *   - methodName
 *   - descriptors:
 *       - propertyNode
 *       - methodNode
 *       - kind
 * }]
 *
 * @param  {Object} node
 * @return {Object[] | undefined}
 */
exports.matchDefinedProperties = matchDefinedProperties;
function _default(node: AstNode) {
  var _matchObjectDefinePro = matchObjectDefinePropertiesCallOnPrototype(node),
    className = optionalText(readProperty(_matchObjectDefinePro, "className")),
    methods = optionalProperties(readProperty(_matchObjectDefinePro, "methods"));
  var isStatic = false;
  if (!className) {
    var _matchObjectDefinePro2 = matchObjectDefinePropertiesCall(node);
    className = optionalText(readProperty(_matchObjectDefinePro2, "className"));
    methods = optionalProperties(readProperty(_matchObjectDefinePro2, "methods"));
    isStatic = true;
  }
  if (className) {
    return methods!.map(function (methodNode) {
      var _matchDefinedProperti = matchDefinedProperties(methodNode),
        methodName = readProperty(_matchDefinedProperti, "methodName"),
        properties = optionalProperties(readProperty(_matchDefinedProperti, "properties"));
      return {
        className: className!,
        methodName: methodName,
        methodNode: methodNode,
        descriptors: properties!.filter(_matchObjectDefinePropertyCall.isAccessorDescriptor).map(function (prop) {
          return {
            propertyNode: prop,
            methodNode: functionProperty(prop).value,
            kind: functionProperty(prop).key.name
          };
        }),
        "static": isStatic
      };
    });
  }
}

/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected the initialized ES module flag");
if (!exportsReady(exports, ["default","matchDefinedProperties"])) throw new TypeError("Incomplete bundled exports");
return exports;
}
