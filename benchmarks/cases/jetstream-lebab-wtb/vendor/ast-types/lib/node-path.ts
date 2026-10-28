import {completeNamedTypes} from "../../../types/ast-types/runtime-named-types.ts";
import type {Fork} from "../../../types/ast-types/types.js";
import type * as K from "../../../types/ast-types/gen/kinds.js";
import type {RuntimePath, RuntimeNodePath, RuntimeScope, NodePathConstructor, PathName} from "../../../types/ast-types/runtime-paths.ts";
import {readProperty} from "../../../webpack.ts";
// Exact module body from JetStream 3.0 ./node_modules/ast-types/lib/node-path.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord} from "../../../webpack.ts";
import {load as load0} from "../../tslib/tslib.es6.ts";
import {load as load1} from "./types.ts";
import {load as load2} from "./path.ts";
import {load as load3} from "./scope.ts";
import {load as load4} from "./shared.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for ast-types/lib/node-path.js");
  return value;
 }
 return initialize();
}
function isExport(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> {
 return exportsReady(value, ["__esModule","default"]);
}
function initialize() {
const exports: { __esModule?: true; "default"?: typeof nodePathPlugin; } = {};
let module = {exports};
cache = module;


"use strict";
/* module decorator */ module = webpack.nmd(module);

Object.defineProperty(exports, "__esModule", ({ value: true }));
var tslib_1 = load0();
var types_1 = tslib_1.__importDefault(load1());
var path_1 = tslib_1.__importDefault(load2());
var scope_1 = tslib_1.__importDefault(load3());
var shared_1 = load4();
function nodePathPlugin(fork: Fork): NodePathConstructor {
    var types = fork.use(types_1.default!);
    var n = completeNamedTypes(types.namedTypes);
    var b = types.builders;
    var isNumber = types.builtInTypes.number;
    var isArray = types.builtInTypes.array;
    var Path = fork.use(path_1.default);
    var Scope = fork.use(scope_1.default);
    class NodePath extends Path {
declare ["constructor"]: NodePathConstructor;
declare node?: K.NodeKind | null;
declare parent?: RuntimePath | null;
declare scope?: RuntimeScope | null;
declare get: (...names: PropertyKey[]) => RuntimeNodePath;
declare replace: RuntimePath['replace'];
declare prune: (...args: unknown[]) => RuntimePath | null;
declare _computeNode: () => K.NodeKind | null;
declare _computeParent: () => RuntimePath | null;
declare _computeScope: () => RuntimeScope | null;
declare getValueProperty: (name: PropertyKey) => unknown;
declare needsParens: (assumeExpressionContext?: boolean) => boolean;
declare canBeFirstInStatement: () => boolean;
declare firstInStatement: () => boolean;

constructor(value: unknown, parentPath?: RuntimePath | null, name?: PathName) {
        super(value, parentPath, name);
        if (!(this instanceof NodePath)) {
            throw new Error("NodePath constructor cannot be invoked without 'new'");
        }
    }
}
    var NPp: NodePath = NodePath.prototype;
    Object.defineProperties(NPp, {
        node: {
            get: function (this: NodePath) {
                Object.defineProperty(this, "node", {
                    configurable: true,
                    value: this._computeNode()
                });
                return this.node;
            }
        },
        parent: {
            get: function (this: NodePath) {
                Object.defineProperty(this, "parent", {
                    configurable: true,
                    value: this._computeParent()
                });
                return this.parent;
            }
        },
        scope: {
            get: function (this: NodePath) {
                Object.defineProperty(this, "scope", {
                    configurable: true,
                    value: this._computeScope()
                });
                return this.scope;
            }
        }
    });
    NPp.replace = function () {
        delete this.node;
        delete this.parent;
        delete this.scope;
        return Path.prototype.replace.apply(this, nodePathReplaceArguments(arguments));
    };
    NPp.prune = function () {
        var remainingNodePath = this.parent;
        this.replace();
        return cleanUpNodesAfterPrune(remainingNodePath);
    };
    // The value of the first ancestor Path whose value is a Node.
    NPp._computeNode = function () {
        var value = this.value;
        if (n.Node.check(value)) {
            return value;
        }
        var pp = this.parentPath;
        return pp && pp.node || null;
    };
    // The first ancestor Path whose value is a Node distinct from this.node.
    NPp._computeParent = function () {
        var value = this.value;
        var pp = this.parentPath;
        if (!n.Node.check(value)) {
            while (pp && !n.Node.check(pp.value)) {
                pp = pp.parentPath;
            }
            if (pp) {
                pp = pp.parentPath;
            }
        }
        while (pp && !n.Node.check(pp.value)) {
            pp = pp.parentPath;
        }
        return pp || null;
    };
    // The closest enclosing scope that governs this node.
    NPp._computeScope = function () {
        var value = this.value;
        var pp = this.parentPath;
        var scope = pp && pp.scope;
        if (n.Node.check(value) &&
            Scope.isEstablishedBy(value)) {
            scope = new Scope(this, scope);
        }
        return scope || null;
    };
    NPp.getValueProperty = function (name) {
        return types.getFieldValue(this.value, name);
    };
    /**
     * Determine whether this.node needs to be wrapped in parentheses in order
     * for a parser to reproduce the same local AST structure.
     *
     * For instance, in the expression `(1 + 2) * 3`, the BinaryExpression
     * whose operator is "+" needs parentheses, because `1 + 2 * 3` would
     * parse differently.
     *
     * If assumeExpressionContext === true, we don't worry about edge cases
     * like an anonymous FunctionExpression appearing lexically first in its
     * enclosing statement and thus needing parentheses to avoid being parsed
     * as a FunctionDeclaration with a missing name.
     */
    NPp.needsParens = function (assumeExpressionContext) {
        var pp = this.parentPath;
        if (!pp) {
            return false;
        }
        var node = this.value;
        // Only expressions need parentheses.
        if (!nodePathExpression(node)) {
            return false;
        }
        // Identifiers never need parentheses.
        if (node.type === "Identifier") {
            return false;
        }
        while (!n.Node.check(pp.value)) {
            pp = pp.parentPath;
            if (!pp) {
                return false;
            }
        }
        var parent = pp.value;
        switch (node.type) {
            case "UnaryExpression":
            case "SpreadElement":
            case "SpreadProperty":
                return parent.type === "MemberExpression"
                    && this.name === "object"
                    && parent.object === node;
            case "BinaryExpression":
            case "LogicalExpression":
                switch (parent.type) {
                    case "CallExpression":
                        return this.name === "callee"
                            && parent.callee === node;
                    case "UnaryExpression":
                    case "SpreadElement":
                    case "SpreadProperty":
                        return true;
                    case "MemberExpression":
                        return this.name === "object"
                            && parent.object === node;
                    case "BinaryExpression":
                    case "LogicalExpression": {
                        var n_1 = node;
                        var po = parent.operator;
                        var pp_1 = PRECEDENCE[po];
                        var no = n_1.operator;
                        var np = PRECEDENCE[no];
                        if (pp_1 > np) {
                            return true;
                        }
                        if (pp_1 === np && this.name === "right") {
                            if (parent.right !== n_1) {
                                throw new Error("Nodes must be equal");
                            }
                            return true;
                        }
                    }
                    default:
                        return false;
                }
            case "SequenceExpression":
                switch (parent.type) {
                    case "ForStatement":
                        // Although parentheses wouldn't hurt around sequence
                        // expressions in the head of for loops, traditional style
                        // dictates that e.g. i++, j++ should not be wrapped with
                        // parentheses.
                        return false;
                    case "ExpressionStatement":
                        return this.name !== "expression";
                    default:
                        // Otherwise err on the side of overparenthesization, adding
                        // explicit exceptions above if this proves overzealous.
                        return true;
                }
            case "YieldExpression":
                switch (parent.type) {
                    case "BinaryExpression":
                    case "LogicalExpression":
                    case "UnaryExpression":
                    case "SpreadElement":
                    case "SpreadProperty":
                    case "CallExpression":
                    case "MemberExpression":
                    case "NewExpression":
                    case "ConditionalExpression":
                    case "YieldExpression":
                        return true;
                    default:
                        return false;
                }
            case "Literal":
                return parent.type === "MemberExpression"
                    && isNumber.check(node.value)
                    && this.name === "object"
                    && parent.object === node;
            case "AssignmentExpression":
            case "ConditionalExpression":
                switch (parent.type) {
                    case "UnaryExpression":
                    case "SpreadElement":
                    case "SpreadProperty":
                    case "BinaryExpression":
                    case "LogicalExpression":
                        return true;
                    case "CallExpression":
                        return this.name === "callee"
                            && parent.callee === node;
                    case "ConditionalExpression":
                        return this.name === "test"
                            && parent.test === node;
                    case "MemberExpression":
                        return this.name === "object"
                            && parent.object === node;
                    default:
                        return false;
                }
            default:
                if (parent.type === "NewExpression" &&
                    this.name === "callee" &&
                    parent.callee === node) {
                    return containsCallExpression(node);
                }
        }
        if (assumeExpressionContext !== true &&
            !this.canBeFirstInStatement() &&
            this.firstInStatement())
            return true;
        return false;
    };
    function isBinary(node: unknown) {
        return n.BinaryExpression.check(node)
            || n.LogicalExpression.check(node);
    }
    // upstream JS type note: 'isUnaryLike' is declared but its value is never read. [6133]
    function isUnaryLike(node: unknown) {
        return n.UnaryExpression.check(node)
            // I considered making SpreadElement and SpreadProperty subtypes
            // of UnaryExpression, but they're not really Expression nodes.
            || (n.SpreadElement && n.SpreadElement.check(node))
            || (n.SpreadProperty && n.SpreadProperty.check(node));
    }
    var PRECEDENCE: Record<string, number> = {};
    [["||"],
        ["&&"],
        ["|"],
        ["^"],
        ["&"],
        ["==", "===", "!=", "!=="],
        ["<", ">", "<=", ">=", "in", "instanceof"],
        [">>", "<<", ">>>"],
        ["+", "-"],
        ["*", "/", "%"]
    ].forEach(function (tier, i) {
        tier.forEach(function (op) {
            PRECEDENCE[op] = i;
        });
    });
    function containsCallExpression(node: unknown): boolean {
        if (n.CallExpression.check(node)) {
            return true;
        }
        if (isArray.check(node)) {
            return node.some(containsCallExpression);
        }
        if (n.Node.check(node)) {
            return types.someField(node, function (_name, child) {
                return containsCallExpression(child);
            });
        }
        return false;
    }
    NPp.canBeFirstInStatement = function () {
        var node = this.node;
        return !n.FunctionExpression.check(node)
            && !n.ObjectExpression.check(node);
    };
    NPp.firstInStatement = function () {
        return firstInStatement(this);
    };
    function firstInStatement(path: RuntimePath) {
        for (var node: K.NodeKind | null | undefined, parent: K.NodeKind | null | undefined; path.parent; path = path.parent) {
            node = path.node;
            parent = path.parent.node;
            if (n.BlockStatement.check(parent) &&
                path.parent.name === "body" &&
                path.name === 0) {
                if (parent.body[0] !== node) {
                    throw new Error("Nodes must be equal");
                }
                return true;
            }
            if (n.ExpressionStatement.check(parent) &&
                path.name === "expression") {
                if (parent.expression !== node) {
                    throw new Error("Nodes must be equal");
                }
                return true;
            }
            if (n.SequenceExpression.check(parent) &&
                path.parent.name === "expressions" &&
                path.name === 0) {
                if (parent.expressions[0] !== node) {
                    throw new Error("Nodes must be equal");
                }
                continue;
            }
            if (n.CallExpression.check(parent) &&
                path.name === "callee") {
                if (parent.callee !== node) {
                    throw new Error("Nodes must be equal");
                }
                continue;
            }
            if (n.MemberExpression.check(parent) &&
                path.name === "object") {
                if (parent.object !== node) {
                    throw new Error("Nodes must be equal");
                }
                continue;
            }
            if (n.ConditionalExpression.check(parent) &&
                path.name === "test") {
                if (parent.test !== node) {
                    throw new Error("Nodes must be equal");
                }
                continue;
            }
            if (isBinary(parent) &&
                path.name === "left") {
                if (parent.left !== node) {
                    throw new Error("Nodes must be equal");
                }
                continue;
            }
            if (n.UnaryExpression.check(parent) &&
                !parent.prefix &&
                path.name === "argument") {
                if (parent.argument !== node) {
                    throw new Error("Nodes must be equal");
                }
                continue;
            }
            return false;
        }
        return true;
    }
    /**
     * Pruning certain nodes will result in empty or incomplete nodes, here we clean those nodes up.
     */
    function cleanUpNodesAfterPrune(remainingNodePath: RuntimePath | null | undefined): RuntimePath | null {
        if (n.VariableDeclaration.check(remainingNodePath!.node)) {
            var declarations = remainingNodePath!.get('declarations').value;
            if (!declarations || readProperty(declarations, "length") === 0) {
                return remainingNodePath!.prune!();
            }
        }
        else if (n.ExpressionStatement.check(remainingNodePath!.node)) {
            if (!remainingNodePath!.get('expression').value) {
                return remainingNodePath!.prune!();
            }
        }
        else if (n.IfStatement.check(remainingNodePath!.node)) {
            cleanUpIfStatementAfterPrune(remainingNodePath!);
        }
        return remainingNodePath!;
    }
    function cleanUpIfStatementAfterPrune(ifStatement: RuntimePath) {
        var testExpression = ifStatement.get('test').value;
        var alternate = ifStatement.get('alternate').value;
        var consequent = ifStatement.get('consequent').value;
        if (!consequent && !alternate) {
            var testExpressionStatement = b.expressionStatement(testExpression);
            ifStatement.replace(testExpressionStatement);
        }
        else if (!consequent && alternate) {
            var negatedTestExpression: unknown = b.unaryExpression('!', testExpression, true);
            if (n.UnaryExpression.check(testExpression) && testExpression.operator === '!') {
                negatedTestExpression = testExpression.argument;
            }
            ifStatement.get("test").replace(negatedTestExpression);
            ifStatement.get("consequent").replace(alternate);
            ifStatement.get("alternate").replace();
        }
    }
    // The legacy switch retains Spread cases even though Expression.check rejects them.
    function nodePathExpression(value: unknown): value is K.ExpressionKind | K.SpreadElementKind | K.SpreadPropertyKind {
        return n.Expression.check(value);
    }
    function nodePathReplaceArguments(value: IArguments): IArguments & [replacement?: unknown, ...args: unknown[]] {
        if (isNodePathReplaceArguments(value)) return value;
        throw new TypeError("Unexpected path replacement arguments");
    }
    function isNodePathReplaceArguments(value: IArguments): value is IArguments & [replacement?: unknown, ...args: unknown[]] {
        return typeof value.length === "number";
    }
    return NodePath;
}
exports["default"] = nodePathPlugin;
;
if (!exportsReady(shared_1, ["maybeSetModuleExports"])) throw new TypeError("Incomplete shared module");
(0, shared_1.maybeSetModuleExports)(function () { return module; });
//# sourceMappingURL=node-path.js.map

/***/ 
if (!exportsReady(module.exports, ["__esModule","default"])) throw new TypeError("Incomplete original module exports");
return module.exports;
}
