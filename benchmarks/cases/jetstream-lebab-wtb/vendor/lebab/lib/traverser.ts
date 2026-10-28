import type {AstNode, LoggerLike} from "../../../ast.ts";
import type {TraversalController, TraversalVisitor} from "../../../traversal-types.ts";
type FindPredicate = (node: AstNode, parent: AstNode | null) => unknown;
interface AstVisitor extends TraversalVisitor {
  enter?: (this: TraversalController, node: AstNode, parent: AstNode | null) => unknown;
  leave?: (this: TraversalController, node: AstNode, parent: AstNode | null) => unknown;
}
interface AstTraverser {
  traverse(tree: AstNode, cfg: AstVisitor): void;
  replace(tree: AstNode, cfg: AstVisitor): unknown;
  VisitorOption: {Break: object; Skip: object; Remove: object};
  find(tree: AstNode, query: string | FindPredicate, opts?: {skipTypes?: string[]}): AstNode | undefined;
  createFindPredicate(query: string | FindPredicate): FindPredicate;
}
import type {Constructor, Descriptor} from "../../../webpack.ts";
// Exact module body from JetStream 3.0 ./node_modules/lebab/lib/traverser.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {runtimeCallable, exportsReady, webpack, isRecord, record, readProperty, symbolValue, primitiveMethod, hasEsModuleFlag} from "../../../webpack.ts";
import {load as load0} from "../../lodash/fp.ts";
import {load as load1} from "../../estraverse/estraverse.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lebab/lib/traverser.js");
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
exports["default"] = void 0;
var _fp = load0();
var _estraverse = _interopRequireDefault(load1());
function _interopRequireDefault<T extends {__esModule: true}>(obj: T): T;
function _interopRequireDefault<T>(obj: T): {default: T};
function _interopRequireDefault(obj: unknown) { return obj && readProperty(obj, "__esModule") ? obj : { "default": obj }; }
// JSX AST types, as documented in:
// https://github.com/facebook/jsx/blob/master/AST.md
var jsxExtensionKeys = {
  keys: {
    JSXIdentifier: [],
    JSXMemberExpression: ['object', 'property'],
    JSXNamespacedName: ['namespace', 'name'],
    JSXEmptyExpression: [],
    JSXExpressionContainer: ['expression'],
    JSXOpeningElement: ['name', 'attributes'],
    JSXClosingElement: ['name'],
    JSXOpeningFragment: [],
    JSXClosingFragment: [],
    JSXAttribute: ['name', 'value'],
    JSXSpreadAttribute: ['argument'],
    JSXElement: ['openingElement', 'closingElement', 'children'],
    JSXFragment: ['openingFragment', 'closingFragment', 'children'],
    JSXText: []
  }
};

/**
 * Proxy for ESTraverse.
 * Providing a single place to easily extend its functionality.
 *
 * Exposes the traverse() and replace() methods just like ESTraverse,
 * plus some custom helpers.
 */
var _default: AstTraverser = {
  /**
   * Traverses AST like ESTraverse.traverse()
   * @param  {Object} tree
   * @param  {Object} cfg Object with optional enter() and leave() methods.
   * @return {Object} The transformed tree
   */
  traverse: function traverse(tree, cfg) {
    return (_estraverse["default"]!).traverse(tree, Object.assign(cfg, jsxExtensionKeys));
  },
  /**
   * Traverses AST like ESTraverse.replace()
   * @param  {Object} tree
   * @param  {Object} cfg Object with optional enter() and leave() methods.
   * @return {Object} The transformed tree
   */
  replace: function replace(tree, cfg) {
    return (_estraverse["default"]!).replace(tree, Object.assign(cfg, jsxExtensionKeys));
  },
  /**
   * Constants to return from enter()/leave() to control traversal:
   *
   * - Skip - skips walking child nodes
   * - Break - ends it all
   * - Remove - removes the current node (only with replace())
   */
  VisitorOption: (_estraverse["default"]!).VisitorOption,
  /**
   * Searches in AST tree for node which satisfies the predicate.
   * @param  {Object} tree
   * @param  {Function|String} query Search function called with `node` and `parent`
   *   Alternatively it can be string: the node type to search for.
   * @param  {String[]} opts.skipTypes List of node types to skip (not traversing into these nodes)
   * @return {Object} The found node or undefined when not found
   */
  find: function find(tree, query) {
    var _ref: unknown = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {},
      _ref$skipTypes = readProperty(_ref, "skipTypes"),
      skipTypes = _ref$skipTypes === void 0 ? [] : _ref$skipTypes;
    var predicate = this.createFindPredicate(query);
    var found: AstNode | undefined;
    this.traverse(tree, {
      enter: function enter(node: AstNode, parent: AstNode | null) {
        if (runtimeCallable(_fp.includes)(node.type, skipTypes)) {
          return (_estraverse["default"]!).VisitorOption.Skip;
        }
        if (predicate(node, parent)) {
          found = node;
          return (_estraverse["default"]!).VisitorOption.Break;
        }
      }
    });
    return found;
  },
  createFindPredicate: function createFindPredicate(query) {
    if ((0, _fp.isString)(query)) {
      return function (node: AstNode) {
        return node.type === query;
      };
    } else {
      return findPredicate(query);
    }
  }
};
exports["default"] = _default;

/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected the initialized ES module flag");
if (!exportsReady(exports, ["default"])) throw new TypeError("Incomplete bundled exports");
return exports;
}

function isFindPredicate(value: unknown): value is FindPredicate { return typeof value === "function"; }
function findPredicate(value: unknown): FindPredicate {
  if (!isFindPredicate(value)) throw new TypeError("Expected the original find predicate");
  return value;
}
