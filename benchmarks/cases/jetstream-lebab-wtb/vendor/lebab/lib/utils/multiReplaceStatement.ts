import {nativeRegExpTest, unknownArray} from "../../../../emitted-helper-types.ts";
import type {AstNode, LoggerLike} from "../../../../ast.ts";
import type {Constructor, Descriptor} from "../../../../webpack.ts";
// Exact module body from JetStream 3.0 ./node_modules/lebab/lib/utils/multiReplaceStatement.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {runtimeCallable, runtimeProperty, runtimeCall, runtimeArrayLike, runtimeArrayLikeOrIterable, runtimeIteratorResult, exportsReady, webpack, isRecord, record, readProperty, symbolValue, primitiveMethod, hasEsModuleFlag} from "../../../../webpack.ts";
import {load as load0} from "./copyComments.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lebab/lib/utils/multiReplaceStatement.js");
  return value;
 }
 return initialize();
}
function isExport(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> {
 return isRecord(value) && value.__esModule === true && value["default"] !== undefined;
}
function initialize() {
const exports: { __esModule?: true; "default"?: typeof multiReplaceStatement; } = {};
let module = {exports};
cache = module;


"use strict";


Object.defineProperty(exports, "__esModule", ({
  value: true
}));
exports["default"] = multiReplaceStatement;
var _copyComments = _interopRequireDefault(load0());
function _interopRequireDefault<T extends {__esModule: true}>(obj: T): T;
function _interopRequireDefault<T>(obj: T): {default: T};
function _interopRequireDefault(obj: unknown) { return obj && readProperty(obj, "__esModule") ? obj : { "default": obj }; }
function _toConsumableArray<T>(arr: Iterable<T, unknown, unknown> | ArrayLike<T>): T[];
function _toConsumableArray(arr: unknown): unknown[] { return _arrayWithoutHoles(arr) || _iterableToArray(arr) || _unsupportedIterableToArray(arr) || _nonIterableSpread(); }
function _nonIterableSpread(): never { throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _unsupportedIterableToArray(o: unknown, minLen?: number): unknown[] | undefined { if (!o) return; if (typeof o === "string") return _arrayLikeToArray(runtimeArrayLike(o), minLen); var n: unknown = Object.prototype.toString.call(o).slice(8, -1); if (n === "Object" && runtimeProperty(o, "constructor")) n = runtimeProperty(runtimeProperty(o, "constructor"), "name"); if (n === "Map" || n === "Set") return Array.from(runtimeArrayLikeOrIterable(o)); if (n === "Arguments" || nativeRegExpTest(/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/, n)) return _arrayLikeToArray(runtimeArrayLike(o), minLen); }
function _iterableToArray(iter: unknown): unknown[] | undefined { if (typeof Symbol !== "undefined" && runtimeProperty(iter, Symbol.iterator) != null || runtimeProperty(iter, "@@iterator") != null) return Array.from(runtimeArrayLikeOrIterable(iter)); }
function _arrayWithoutHoles(arr: unknown): unknown[] | undefined { if (Array.isArray(arr)) return _arrayLikeToArray(arr); }
function _arrayLikeToArray<T>(arr: ArrayLike<T>, len?: number | null): T[] { if (len == null || len > arr.length) len = arr.length; for (var i = 0, arr2 = new Array<T>(len); i < len; i++) arr2[i] = arr[i]; return arr2; }
/**
 * Replaces `node` inside `parent` with any number of `replacements`.
 *
 * ESTraverse only allows replacing one node with a single other node.
 * This function overcomes this limitation, allowing to replace it with multiple nodes.
 *
 * NOTE: Only works for nodes that allow multiple elements in their body.
 *       When node doesn't exist inside parent, does nothing.
 *
 * @param  {Object} cfg
 *   @param  {Object} cfg.parent Parent node of the node to replace
 *   @param  {Object} cfg.node The node to replace
 *   @param  {Object[]} cfg.replacements Replacement nodes (can be empty array)
 *   @param  {Boolean} [cfg.preserveComments] True to copy over comments from
 *     node to first replacement node
 */
function multiReplaceStatement(_ref: {parent: AstNode | null | undefined; node: AstNode | undefined; replacements: AstNode[]; preserveComments?: boolean}) {
  var parent = _ref.parent,
    node = _ref.node,
    replacements = _ref.replacements,
    preserveComments = _ref.preserveComments;
  var body = getBody(parent);
  var index = body.indexOf(node);
  if (preserveComments && replacements[0]) {
    (0, _copyComments["default"])({
      from: node,
      to: replacements[0]
    });
  }
  if (index !== -1) {
    runtimeCallable(body.splice).apply(body, unknownArray([index, 1]).concat(_toConsumableArray(replacements)));
  }
}
function getBody(node: AstNode | null | undefined): (AstNode | undefined)[] {
  switch (node!.type) {
    case 'BlockStatement':
    case 'Program':
      return node!.body;
    case 'SwitchCase':
      return node!.consequent;
    case 'ObjectExpression':
      return node!.properties;
    default:
      throw "Unsupported node type '".concat(node!.type, "' in multiReplaceStatement()");
  }
}

/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected the initialized ES module flag");
if (!exportsReady(exports, ["default"])) throw new TypeError("Incomplete bundled exports");
return exports;
}
