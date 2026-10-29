import type * as K from "../../../../../types/ast-types/gen/kinds.js";
import {classBlock, classText, optionalText, classNode, classExpression, optionalExpression, classFunction, classIdentifier, classVariableDeclaration, classCallStatement, classObject, classProperties, optionalProperties, functionProperty, descriptorArray, methodMatches, matchFlag, relatedExpressions, unknownArray, type ClassFunction, type MethodConfig, type RelatedExpression, type Replacement, type ClassConfig} from "./runtime.ts";
import type {AstNode, LoggerLike} from "../../../../../ast.ts";
import type {Constructor, Descriptor} from "../../../../../webpack.ts";
// Exact module body from JetStream 3.0 ./node_modules/lebab/lib/transform/class/PotentialMethod.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord, record, readProperty, symbolValue, primitiveMethod, hasEsModuleFlag} from "../../../../../webpack.ts";
import {load as load0} from "../../traverser.ts";
import {load as load1} from "../../utils/isEqualAst.ts";
import {load as load2} from "../../../../f-matches/index.ts";
import {load as load3} from "./extractComments.ts";
import {load as load4} from "../../utils/multiReplaceStatement.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lebab/lib/transform/class/PotentialMethod.js");
  return value;
 }
 return initialize();
}
function isExport(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> {
 return isRecord(value) && value.__esModule === true && value["default"] !== undefined;
}
function initialize() {
const exports: { __esModule?: true; "default"?: typeof PotentialMethod; } = {};
let module = {exports};
cache = module;


"use strict";


Object.defineProperty(exports, "__esModule", ({
  value: true
}));
exports["default"] = void 0;
var _traverser = _interopRequireDefault(load0());
var _isEqualAst = _interopRequireDefault(load1());
var _fMatches = load2();
var _extractComments = _interopRequireDefault(load3());
var _multiReplaceStatement = _interopRequireDefault(load4());
function _interopRequireDefault<T extends {__esModule: true}>(obj: T): T;
function _interopRequireDefault<T>(obj: T): {default: T};
function _interopRequireDefault(obj: unknown) { return obj && readProperty(obj, "__esModule") ? obj : { "default": obj }; }
var _typeof = function(obj: unknown): string { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (obj: unknown) { return typeof obj; } : function (obj: unknown) { return obj && "function" == typeof Symbol && readProperty(obj, "constructor") === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }, _typeof(obj); };
function _classCallCheck(instance: unknown, Constructor: Constructor): void { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }
function _defineProperties(target: object, props: Descriptor[]): void { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, _toPropertyKey(descriptor.key), descriptor); } }
function _createClass<T extends Constructor>(Constructor: T, protoProps?: Descriptor[], staticProps?: Descriptor[]): T { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); Object.defineProperty(Constructor, "prototype", { writable: false }); return Constructor; }
function _toPropertyKey(arg: unknown): PropertyKey { var key = _toPrimitive(arg, "string"); return _typeof(key) === "symbol" ? symbolValue(key) : String(key); }
function _toPrimitive(input: unknown, hint?: string): unknown { if (_typeof(input) !== "object" || input === null) return input; var prim = primitiveMethod(readProperty(input, Symbol.toPrimitive)); if (prim !== undefined) { var res = prim.call(input, hint || "default"); if (_typeof(res) !== "object") return res; throw new TypeError("@@toPrimitive must return a primitive value."); } return (hint === "string" ? String : Number)(input); }
/**
 * Represents a potential class method to be created.
 */
class PotentialMethod {
declare "name": unknown;
declare "methodNode": ClassFunction;
declare "fullNode": AstNode | undefined;
declare "commentNodes": AstNode[];
declare "parent": AstNode | null | undefined;
declare "kind": string;
declare "static": boolean;
declare "superClass": K.ExpressionKind | undefined;
constructor(cfg: MethodConfig) {
    this.name = cfg.name;
    this.methodNode = cfg.methodNode;
    this.fullNode = cfg.fullNode;
    this.commentNodes = cfg.commentNodes || [];
    this.parent = cfg.parent;
    this.kind = cfg.kind || 'method';
    this["static"] = cfg["static"] || false;
  }
setSuperClass(superClass: K.ExpressionKind | undefined) {
      this.superClass = superClass;
    }

isEmpty() {
      return this.getBodyBlock().body.length === 0;
    }

toMethodDefinition() {
      return {
        type: 'MethodDefinition',
        key: {
          type: 'Identifier',
          name: this.name
        },
        computed: false,
        value: {
          type: 'FunctionExpression',
          async: this.methodNode.async,
          params: this.methodNode.params,
          defaults: this.methodNode.defaults,
          body: this.getBody(),
          generator: false,
          expression: false
        },
        kind: this.kind,
        "static": this["static"],
        comments: (0, _extractComments["default"])(this.commentNodes)
      };
    }

remove() {
      (0, _multiReplaceStatement["default"])({
        parent: this.parent,
        node: this.fullNode,
        replacements: []
      });
    }

getBody() {
      if (this.superClass) {
        return this.transformSuperCalls(this.getBodyBlock());
      } else {
        return this.getBodyBlock();
      }
    }

getBodyBlock(): K.BlockStatementKind {
      if (this.methodNode.body.type === 'BlockStatement') {
        return this.methodNode.body;
      } else {
        return {
          type: 'BlockStatement',
          body: [{
            type: 'ReturnStatement',
            argument: this.methodNode.body
          }]
        };
      }
    }

transformSuperCalls(body: K.BlockStatementKind): K.BlockStatementKind {
      var _this = this;
      return classBlock((_traverser["default"]!).replace(body, {
        enter: function enter(node: AstNode) {
          var m = _this.matchSuperCall(node);
          if (m) {
            classCallStatement(node).expression.callee = {
              type: 'MemberExpression',
              computed: false,
              object: {
                type: 'Super'
              },
              property: classIdentifier(readProperty(m, "method"))
            };
            classCallStatement(node).expression.arguments = classCallStatement(node).expression.arguments.slice(1);
          }
        }
      }));
    }

matchSuperCall(node: AstNode) {
      var _this2 = this;
      return (0, _fMatches.matches)({
        type: 'ExpressionStatement',
        expression: {
          type: 'CallExpression',
          callee: {
            type: 'MemberExpression',
            computed: false,
            object: {
              type: 'MemberExpression',
              computed: false,
              object: {
                type: 'MemberExpression',
                computed: false,
                object: function object(obj: unknown) {
                  return (0, _isEqualAst["default"])(obj, _this2.superClass);
                },
                property: {
                  type: 'Identifier',
                  name: 'prototype'
                }
              },
              property: (0, _fMatches.extract)('method', {
                type: 'Identifier'
              })
            },
            property: {
              type: 'Identifier',
              name: 'call'
            }
          },
          arguments: [{
            type: 'ThisExpression'
          }]
        }
      }, node);
    }
}
exports["default"] = PotentialMethod;

/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected the initialized ES module flag");
if (!exportsReady(exports, ["default"])) throw new TypeError("Incomplete bundled exports");
return exports;
}
