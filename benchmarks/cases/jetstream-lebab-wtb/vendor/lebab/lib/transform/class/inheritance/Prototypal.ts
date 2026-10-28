import type * as K from "../../../../../../types/ast-types/gen/kinds.js";
import {classText, optionalText, classNode, classExpression, optionalExpression, classFunction, classIdentifier, classVariableDeclaration, classCallStatement, classObject, classProperties, optionalProperties, functionProperty, descriptorArray, methodMatches, matchFlag, relatedExpressions, unknownArray, type ClassFunction, type MethodConfig, type RelatedExpression, type Replacement, type ClassConfig} from "../runtime.ts";
import type {AstNode, LoggerLike} from "../../../../../../ast.ts";
import type {Constructor, Descriptor} from "../../../../../../webpack.ts";
// Exact module body from JetStream 3.0 ./node_modules/lebab/lib/transform/class/inheritance/Prototypal.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord, record, readProperty, symbolValue, primitiveMethod, hasEsModuleFlag} from "../../../../../../webpack.ts";
import {load as load0} from "../../../../../f-matches/index.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lebab/lib/transform/class/inheritance/Prototypal.js");
  return value;
 }
 return initialize();
}
function isExport(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> {
 return isRecord(value) && value.__esModule === true && value["default"] !== undefined;
}
function initialize() {
const exports: { __esModule?: true; "default"?: typeof Prototypal; } = {};
let module = {exports};
cache = module;


"use strict";


Object.defineProperty(exports, "__esModule", ({
  value: true
}));
exports["default"] = void 0;
var _fMatches = load0();
var _typeof = function(obj: unknown): string { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (obj: unknown) { return typeof obj; } : function (obj: unknown) { return obj && "function" == typeof Symbol && readProperty(obj, "constructor") === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }, _typeof(obj); };
function _classCallCheck(instance: unknown, Constructor: Constructor): void { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }
function _defineProperties(target: object, props: Descriptor[]): void { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, _toPropertyKey(descriptor.key), descriptor); } }
function _createClass<T extends Constructor>(Constructor: T, protoProps?: Descriptor[], staticProps?: Descriptor[]): T { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); Object.defineProperty(Constructor, "prototype", { writable: false }); return Constructor; }
function _toPropertyKey(arg: unknown): PropertyKey { var key = _toPrimitive(arg, "string"); return _typeof(key) === "symbol" ? symbolValue(key) : String(key); }
function _toPrimitive(input: unknown, hint?: string): unknown { if (_typeof(input) !== "object" || input === null) return input; var prim = primitiveMethod(readProperty(input, Symbol.toPrimitive)); if (prim !== undefined) { var res = prim.call(input, hint || "default"); if (_typeof(res) !== "object") return res; throw new TypeError("@@toPrimitive must return a primitive value."); } return (hint === "string" ? String : Number)(input); }
/**
 * Processes nodes to detect super classes and return information for later
 * transformation.
 *
 * Detects:
 *
 *   Class1.prototype = Object.create(Class2.prototype);
 *
 * or:
 *
 *   Class1.prototype = new Class2();
 *
 * optionally followed by:
 *
 *   Class1.prototype.constructor = Class1;
 */
class Prototypal {
declare "foundSuperclasses": Record<string, K.ExpressionKind>;
constructor() {
    this.foundSuperclasses = {};
  }
process(node: AstNode, parent: AstNode | null) {
      var m: import("../../../../../f-matches/index.ts").MatchResult;
      if (m = this.matchNewAssignment(node) || this.matchObjectCreateAssignment(node)) {
        this.foundSuperclasses[classText(readProperty(m, "className"))] = classExpression(readProperty(m, "superClass"));
        return {
          className: classText(readProperty(m, "className")),
          superClass: classExpression(readProperty(m, "superClass")),
          relatedExpressions: [{
            node: node,
            parent: parent
          }]
        };
      } else if (m = this.matchConstructorAssignment(node)) {
        var superClass = this.foundSuperclasses[classText(readProperty(m, "className"))];
        if (superClass && classText(readProperty(m, "className")) === readProperty(m, "constructorClassName")) {
          return {
            className: classText(readProperty(m, "className")),
            superClass: superClass,
            relatedExpressions: [{
              node: node,
              parent: parent
            }]
          };
        }
      }
    }

matchNewAssignment(node: AstNode) {
      return (0, _fMatches.matches)({
        type: 'ExpressionStatement',
        expression: {
          type: 'AssignmentExpression',
          left: {
            type: 'MemberExpression',
            object: {
              type: 'Identifier',
              name: (0, _fMatches.extractAny)('className')
            },
            property: {
              type: 'Identifier',
              name: 'prototype'
            }
          },
          right: {
            type: 'NewExpression',
            callee: (0, _fMatches.extractAny)('superClass')
          }
        }
      }, node);
    }

matchObjectCreateAssignment(node: AstNode) {
      return (0, _fMatches.matches)({
        type: 'ExpressionStatement',
        expression: {
          type: 'AssignmentExpression',
          left: {
            type: 'MemberExpression',
            object: {
              type: 'Identifier',
              name: (0, _fMatches.extractAny)('className')
            },
            property: {
              type: 'Identifier',
              name: 'prototype'
            }
          },
          right: {
            type: 'CallExpression',
            callee: {
              type: 'MemberExpression',
              object: {
                type: 'Identifier',
                name: 'Object'
              },
              property: {
                type: 'Identifier',
                name: 'create'
              }
            },
            arguments: (0, _fMatches.matchesLength)([{
              type: 'MemberExpression',
              object: (0, _fMatches.extractAny)('superClass'),
              property: {
                type: 'Identifier',
                name: 'prototype'
              }
            }])
          }
        }
      }, node);
    }

matchConstructorAssignment(node: AstNode) {
      return (0, _fMatches.matches)({
        type: 'ExpressionStatement',
        expression: {
          type: 'AssignmentExpression',
          left: {
            type: 'MemberExpression',
            object: {
              type: 'MemberExpression',
              object: {
                type: 'Identifier',
                name: (0, _fMatches.extractAny)('className')
              },
              property: {
                type: 'Identifier',
                name: 'prototype'
              }
            },
            property: {
              type: 'Identifier',
              name: 'constructor'
            }
          },
          right: {
            type: 'Identifier',
            name: (0, _fMatches.extractAny)('constructorClassName')
          }
        }
      }, node);
    }
}
exports["default"] = Prototypal;

/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected the initialized ES module flag");
if (!exportsReady(exports, ["default"])) throw new TypeError("Incomplete bundled exports");
return exports;
}
