import type {WildcardCache, WildcardCacheFactory} from "../../../../../emitted-helper-types.ts";
import type * as K from "../../../../../types/ast-types/gen/kinds.js";
import {prototypeMethods, classText, optionalText, classNode, classExpression, optionalExpression, classFunction, classIdentifier, classVariableDeclaration, classCallStatement, classObject, classProperties, optionalProperties, functionProperty, descriptorArray, methodMatches, matchFlag, relatedExpressions, unknownArray, type ClassFunction, type MethodConfig, type RelatedExpression, type Replacement, type ClassConfig} from "./runtime.ts";
import type {AstNode, LoggerLike} from "../../../../../ast.ts";
import type {Constructor, Descriptor} from "../../../../../webpack.ts";
// Exact module body from JetStream 3.0 ./node_modules/lebab/lib/transform/class/index.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {runtimeArrayLikeOrIterable, runtimeArrayLike, runtimeProperty, runtimeCallable, exportsReady, webpack, isRecord, record, readProperty, symbolValue, primitiveMethod, hasEsModuleFlag} from "../../../../../webpack.ts";
import {load as load0} from "../../../../lodash/fp.ts";
import {load as load1} from "../../traverser.ts";
import {load as load2} from "./PotentialClass.ts";
import {load as load3} from "./PotentialMethod.ts";
import {load as load4} from "./PotentialConstructor.ts";
import {load as load5} from "./matchFunctionDeclaration.ts";
import {load as load6} from "./matchFunctionVar.ts";
import {load as load7} from "./matchFunctionAssignment.ts";
import {load as load8} from "./matchPrototypeFunctionAssignment.ts";
import {load as load9} from "./matchPrototypeObjectAssignment.ts";
import {load as load10} from "./matchObjectDefinePropertyCall.ts";
import {load as load11} from "./inheritance/Inheritance.ts";
import {load as load12} from "./matchObjectDefinePropertiesCall.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lebab/lib/transform/class/index.js");
  return value;
 }
 return initialize();
}
function isExport(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> {
 return isRecord(value) && value.__esModule === true && value["default"] !== undefined;
}
function initialize() {
let _getRequireWildcardCache: WildcardCacheFactory = function(nodeInterop?: boolean): WildcardCache | null { if (typeof WeakMap !== "function") return null; var cacheBabelInterop = new WeakMap<object, Record<string, unknown>>(); var cacheNodeInterop = new WeakMap<object, Record<string, unknown>>(); return (_getRequireWildcardCache = function _getRequireWildcardCache(nodeInterop?: boolean) { return nodeInterop ? cacheNodeInterop : cacheBabelInterop; })(nodeInterop); };
const exports: { __esModule?: true; "default"?: typeof _default; } = {};
let module = {exports};
cache = module;


"use strict";


var _typeof = function(obj: unknown): string { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (obj: unknown) { return typeof obj; } : function (obj: unknown) { return obj && "function" == typeof Symbol && readProperty(obj, "constructor") === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }, _typeof(obj); };
Object.defineProperty(exports, "__esModule", ({
  value: true
}));
exports["default"] = _default;
var _fp = load0();
var _traverser = _interopRequireDefault(load1());
var _PotentialClass = _interopRequireDefault(load2());
var _PotentialMethod = _interopRequireDefault(load3());
var _PotentialConstructor = _interopRequireDefault(load4());
var _matchFunctionDeclaration = _interopRequireDefault(load5());
var _matchFunctionVar = _interopRequireDefault(load6());
var _matchFunctionAssignment = _interopRequireDefault(load7());
var _matchPrototypeFunctionAssignment = _interopRequireDefault(load8());
var _matchPrototypeObjectAssignment = _interopRequireDefault(load9());
var _matchObjectDefinePropertyCall = _interopRequireWildcard(load10());
var _Inheritance = _interopRequireDefault(load11());
var _matchObjectDefinePropertiesCall = _interopRequireWildcard(load12());

function _interopRequireWildcard<T extends {__esModule: true}>(obj: T, nodeInterop?: false): T;
function _interopRequireWildcard(obj: unknown, nodeInterop?: boolean): unknown;
function _interopRequireWildcard(obj: unknown, nodeInterop?: boolean): unknown { if (!nodeInterop && obj && readProperty(obj, "__esModule")) { return obj; } if (obj === null || _typeof(obj) !== "object" && typeof obj !== "function") { return { "default": obj }; } var cache = _getRequireWildcardCache(nodeInterop); if (cache && cache.has(record(obj))) { return cache.get(record(obj)); } var newObj: Record<string, unknown> = {}; var hasPropertyDescriptor = readProperty(Object, "defineProperty") && Object.getOwnPropertyDescriptor; for (var key in record(obj)) { if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) { var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null; if (desc && (desc.get || desc.set)) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = readProperty(obj, key); } } } newObj["default"] = obj; if (cache) { cache.set(record(obj), newObj); } return newObj; }
function _interopRequireDefault<T extends {__esModule: true}>(obj: T): T;
function _interopRequireDefault<T>(obj: T): {default: T};
function _interopRequireDefault(obj: unknown) { return obj && readProperty(obj, "__esModule") ? obj : { "default": obj }; }
function _default(ast: AstNode, logger: LoggerLike) {
  var potentialClasses: Record<string, InstanceType<ReturnType<typeof load2>["default"]>> = {};
  var inheritance = new (_Inheritance["default"]!)();
  (_traverser["default"]!).traverse(ast, {
    enter: function enter(node: AstNode, parent: AstNode | null) {
      var m: unknown;
      if (m = (0, _matchFunctionDeclaration["default"])(node) || (0, _matchFunctionVar["default"])(node)) {
        potentialClasses[classText(readProperty(m, "className"))] = new (_PotentialClass["default"]!)({
          name: classText(readProperty(m, "className")),
          fullNode: node,
          commentNodes: [node],
          parent: parent
        });
        potentialClasses[classText(readProperty(m, "className"))].setConstructor(new (_PotentialConstructor["default"]!)({
          methodNode: classFunction(readProperty(m, "constructorNode")),
          potentialClass: potentialClasses[classText(readProperty(m, "className"))]
        }));
      } else if (m = (0, _matchFunctionAssignment["default"])(node)) {
        if (potentialClasses[classText(readProperty(m, "className"))]) {
          potentialClasses[classText(readProperty(m, "className"))].addMethod(new (_PotentialMethod["default"]!)({
            name: readProperty(m, "methodName"),
            methodNode: classFunction(readProperty(m, "methodNode")),
            fullNode: node,
            commentNodes: [node],
            parent: parent,
            "static": true
          }));
        }
      } else if (m = (0, _matchPrototypeFunctionAssignment["default"])(node)) {
        if (potentialClasses[classText(readProperty(m, "className"))]) {
          potentialClasses[classText(readProperty(m, "className"))].addMethod(new (_PotentialMethod["default"]!)({
            name: readProperty(m, "methodName"),
            methodNode: classFunction(readProperty(m, "methodNode")),
            fullNode: node,
            commentNodes: [node],
            parent: parent
          }));
        }
      } else if (m = (0, _matchPrototypeObjectAssignment["default"])(node)) {
        if (potentialClasses[classText(readProperty(m, "className"))]) {
          prototypeMethods(readProperty(m, "methods")).forEach(function (method, i: number) {
            var assignmentComments = i === 0 ? [node] : [];
            potentialClasses[classText(readProperty(m, "className"))].addMethod(new (_PotentialMethod["default"]!)({
              name: method.methodName,
              methodNode: method.methodNode,
              fullNode: node,
              commentNodes: assignmentComments.concat([method.propertyNode]),
              parent: parent,
              kind: classMethodKind(method.kind)
            }));
          });
        }
      } else if (m = (0, _matchObjectDefinePropertyCall["default"])(node)) {
        if (potentialClasses[classText(readProperty(m, "className"))]) {
          descriptorArray(readProperty(m, "descriptors")).forEach(function (desc, i: number) {
            var parentComments = i === 0 ? [node] : [];
            potentialClasses[classText(readProperty(m, "className"))].addMethod(new (_PotentialMethod["default"]!)({
              name: readProperty(m, "methodName"),
              methodNode: desc.methodNode,
              fullNode: node,
              commentNodes: parentComments.concat([desc.propertyNode]),
              parent: parent,
              kind: desc.kind,
              "static": matchFlag(readProperty(m, "static"))
            }));
          });
        }
      } else if (m = (0, _matchObjectDefinePropertiesCall["default"])(node)) {
        // defineProperties allows mixing method definitions we CAN transform
        // with ones we CANT. This check looks for whether every property is
        // one we CAN transform and if they are it removes the whole call
        // to defineProperties
        var removeWholeNode = false;
        if (classObject(classCallStatement(node).expression.arguments[1]).properties.every(function (propertyNode) {
          var _matchDefinedProperti = (0, _matchObjectDefinePropertiesCall.matchDefinedProperties)(propertyNode),
            properties = optionalProperties(readProperty(_matchDefinedProperti, "properties"));
          return properties!.some(_matchObjectDefinePropertyCall.isAccessorDescriptor);
        })) {
          removeWholeNode = true;
        }
        methodMatches(m).forEach(function (method, i: number) {
          if (potentialClasses[method.className]) {
            method.descriptors.forEach(function (desc, j: number) {
              var parentComments = j === 0 ? [method.methodNode] : [];

              // by default remove only the single method property of the object passed to defineProperties
              // otherwise if they should all be remove AND this is the last descriptor set it up
              // to remove the whole node that's calling defineProperties
              var lastDescriptor = i === methodMatches(m).length - 1 && j === method.descriptors.length - 1;
              var fullNode = lastDescriptor && removeWholeNode ? node : method.methodNode;
              var parentNode = lastDescriptor && removeWholeNode ? parent : classObject(classCallStatement(node).expression.arguments[1]);
              potentialClasses[method.className].addMethod(new (_PotentialMethod["default"]!)({
                name: method.methodName,
                methodNode: desc.methodNode,
                fullNode: fullNode,
                commentNodes: parentComments.concat([desc.propertyNode]),
                parent: parentNode,
                kind: desc.kind,
                "static": method["static"]
              }));
            });
          }
        });
      } else if (m = inheritance.process(node, parent)) {
        if (potentialClasses[classText(readProperty(m, "className"))]) {
          potentialClasses[classText(readProperty(m, "className"))].setSuperClass(classExpression(readProperty(m, "superClass")), relatedExpressions(readProperty(m, "relatedExpressions")));
        }
      }
    },
    leave: function leave(node: { type: string; }) {
      if (node.type === 'Program') {
        (0, _fp.values)(potentialClasses).filter(function (cls) {
          return cls.isTransformable() ? true : logWarning(cls);
        }).forEach(function (cls) {
          return cls.transform();
        });
      }
    }
  });

  // Ordinary methods inside class use kind=method,
  // unlike methods inside object literal, which use kind=init.
  function classMethodKind(kind: string) {
    return kind === 'init' ? 'method' : kind;
  }
  function logWarning(cls: InstanceType<ReturnType<typeof load2>["default"]>) {
    if (/^[A-Z]/.test(cls.getName())) {
      logger.warn(cls.getFullNode(), "Function ".concat(cls.getName(), " looks like class, but has no prototype"), 'class');
    }
  }
}

/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected the initialized ES module flag");
if (!exportsReady(exports, ["default"])) throw new TypeError("Incomplete bundled exports");
return exports;
}
