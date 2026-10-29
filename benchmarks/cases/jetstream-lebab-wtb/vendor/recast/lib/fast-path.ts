import type * as K from "../../../types/ast-types/gen/kinds.js";
import type {RuntimePath} from "../../../types/ast-types/runtime-paths.ts";
import type {RuntimeFastPath, FastPathPosition, FastPathLocation, FastPathToken} from "../../../types/recast/runtime-fast-path.ts";
// Exact module body from JetStream 3.0 ./node_modules/recast/lib/fast-path.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord, record, readProperty, runtimeArrayLike} from "../../../webpack.ts";
import {load as load0} from "../../tslib/tslib.es6.ts";
import {load as load1} from "../../tiny-invariant/dist/tiny-invariant.cjs.ts";
import {load as load2} from "../../ast-types/lib/main.ts";
import {load as load3} from "./util.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for recast/lib/fast-path.js");
  return value;
 }
 return initialize();
}
function isExport(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> {
 return exportsReady(value, ["__esModule","default"]);
}
function initialize() {
const exports: { __esModule?: true; "default"?: typeof FastPath; } = {};
let module = {exports};
cache = module;


"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
var tslib_1 = load0();
var tiny_invariant_1: {default: (condition: unknown, message?: string | (() => string)) => void} = tslib_1.__importDefault(load1());
var types = tslib_1.__importStar(load2());
var util = tslib_1.__importStar(load3());
var n = types.namedTypes;
var isArray = types.builtInTypes.array;
var isNumber = types.builtInTypes.number;
var PRECEDENCE: Record<string, number> = {};
[
    ["??"],
    ["||"],
    ["&&"],
    ["|"],
    ["^"],
    ["&"],
    ["==", "===", "!=", "!=="],
    ["<", ">", "<=", ">=", "in", "instanceof"],
    [">>", "<<", ">>>"],
    ["+", "-"],
    ["*", "/", "%"],
    ["**"],
].forEach(function (tier, i) {
    tier.forEach(function (op) {
        PRECEDENCE[op] = i;
    });
});
class FastPath {
declare stack: unknown[];
declare copy: () => RuntimeFastPath;
declare getName: () => PropertyKey | null | undefined;
declare getValue: (...ignored: unknown[]) => unknown;
declare valueIsDuplicate: () => boolean;
declare getNode: (count?: number) => K.NodeKind | null;
declare getParentNode: (count?: number) => K.NodeKind | null;
declare getRootValue: () => unknown;
declare call: <T>(callback: (path: RuntimeFastPath) => T, ...names: PropertyKey[]) => T;
declare each: (callback: (path: RuntimeFastPath) => unknown, ...names: PropertyKey[]) => void;
declare map: <T>(callback: (path: RuntimeFastPath, index: number) => T, ...names: PropertyKey[]) => T[];
declare hasParens: () => boolean;
declare getPrevToken: (node?: K.NodeKind | null) => FastPathToken | null;
declare getNextToken: (node?: K.NodeKind | null) => FastPathToken | null;
declare needsParens: (assumeExpressionContext?: boolean) => boolean;
declare canBeFirstInStatement: () => boolean;
declare firstInStatement: () => boolean;
declare static from: (obj: unknown) => RuntimeFastPath;
constructor(value: unknown) {
    (0, tiny_invariant_1.default)(this instanceof FastPath);
    this.stack = [value];
}
}
var FPp: RuntimeFastPath = FastPath.prototype;
// Static convenience function for coercing a value to a FastPath.
FastPath.from = function (obj) {
    if (obj instanceof FastPath) {
        // Return a defensive copy of any existing FastPath instances.
        return obj.copy();
    }
    if (obj instanceof types.NodePath) {
        // For backwards compatibility, unroll NodePath instances into
        // lightweight FastPath [..., name, value] stacks.
        var copy: unknown = Object.create(FastPath.prototype);
        var stack = [obj.value];
        for (var pp: RuntimePath | null | undefined = void 0; (pp = fastNodePath(obj).parentPath); obj = pp)
            stack.push(fastNodePath(obj).name, pp.value);
        record(copy).stack = stack.reverse();
        return fastPathInstance(copy);
    }
    // Otherwise use obj as the value of the new FastPath instance.
    return new FastPath(obj);
};
FPp.copy = function copy() {
    var copy: unknown = Object.create(FastPath.prototype);
    record(copy).stack = this.stack.slice(0);
    return fastPathInstance(copy);
};
// The name of the current property is always the penultimate element of
// this.stack, and always a String.
FPp.getName = function getName() {
    var s = this.stack;
    var len = s.length;
    if (len > 1) {
        return fastPathName(s[len - 2]);
    }
    // Since the name is always a string, null is a safe sentinel value to
    // return if we do not know the name of the (root) value.
    return null;
};
// The value of the current property is always the final element of
// this.stack.
FPp.getValue = function getValue() {
    var s = this.stack;
    return s[s.length - 1];
};
FPp.valueIsDuplicate = function () {
    var s = this.stack;
    var valueIndex = s.length - 1;
    return s.lastIndexOf(s[valueIndex], valueIndex - 1) >= 0;
};
function getNodeHelper(path: RuntimeFastPath, count: number): K.NodeKind | null {
    var s = path.stack;
    for (var i = s.length - 1; i >= 0; i -= 2) {
        var value = s[i];
        if (n.Node.check(value) && --count < 0) {
            return value;
        }
    }
    return null;
}
FPp.getNode = function getNode(count) {
    if (count === void 0) { count = 0; }
    return getNodeHelper(this, ~~count);
};
FPp.getParentNode = function getParentNode(count) {
    if (count === void 0) { count = 0; }
    return getNodeHelper(this, ~~count + 1);
};
// The length of the stack can be either even or odd, depending on whether
// or not we have a name for the root value. The difference between the
// index of the root value and the index of the final value is always
// even, though, which allows us to return the root value in constant time
// (i.e. without iterating backwards through the stack).
FPp.getRootValue = function getRootValue() {
    var s = this.stack;
    if (s.length % 2 === 0) {
        return s[1];
    }
    return s[0];
};
// Temporarily push properties named by string arguments given after the
// callback function onto this.stack, then call the callback with a
// reference to this (modified) FastPath object. Note that the stack will
// be restored to its original state after the callback is finished, so it
// is probably a mistake to retain a reference to the path.
FPp.call = function call<T>(callback: (path: RuntimeFastPath) => T /*, name1, name2, ... */) {
    var s = this.stack;
    var origLen = s.length;
    var value = s[origLen - 1];
    var argc = arguments.length;
    for (var i = 1; i < argc; ++i) {
        var name: unknown = arguments[i];
        value = readProperty(value, fastPathKey(name));
        s.push(name, value);
    }
    var result = callback(this);
    s.length = origLen;
    return result;
};
// Similar to FastPath.prototype.call, except that the value obtained by
// accessing this.getValue()[name1][name2]... should be array-like. The
// callback will be called with a reference to this path object for each
// element of the array.
FPp.each = function each(callback /*, name1, name2, ... */) {
    var s = this.stack;
    var origLen = s.length;
    var value = s[origLen - 1];
    var argc = arguments.length;
    for (var i = 1; i < argc; ++i) {
        var name: unknown = arguments[i];
        value = readProperty(value, fastPathKey(name));
        s.push(name, value);
    }
    for (var i = 0; i < runtimeArrayLike(value).length; ++i) {
        if (i in record(value)) {
            s.push(i, readProperty(value, i));
            // If the callback needs to know the value of i, call
            // path.getName(), assuming path is the parameter name.
            callback(this);
            s.length -= 2;
        }
    }
    s.length = origLen;
};
// Similar to FastPath.prototype.each, except that the results of the
// callback function invocations are stored in an array and returned at
// the end of the iteration.
FPp.map = function map<T>(callback: (path: RuntimeFastPath, index: number) => T /*, name1, name2, ... */) {
    var s = this.stack;
    var origLen = s.length;
    var value = s[origLen - 1];
    var argc = arguments.length;
    for (var i = 1; i < argc; ++i) {
        var name: unknown = arguments[i];
        value = readProperty(value, fastPathKey(name));
        s.push(name, value);
    }
    var result = new Array<T>(runtimeArrayLike(value).length);
    for (var i = 0; i < runtimeArrayLike(value).length; ++i) {
        if (i in record(value)) {
            s.push(i, readProperty(value, i));
            result[i] = callback(this, i);
            s.length -= 2;
        }
    }
    s.length = origLen;
    return result;
};
// Returns true if the node at the tip of the path is wrapped with
// parentheses, OR if the only reason the node needed parentheses was that
// it couldn't be the first expression in the enclosing statement (see
// FastPath#canBeFirstInStatement), and it has an opening `(` character.
// For example, the FunctionExpression in `(function(){}())` appears to
// need parentheses only because it's the first expression in the AST, but
// since it happens to be preceded by a `(` (which is not apparent from
// the AST but can be determined using FastPath#getPrevToken), there is no
// ambiguity about how to parse it, so it counts as having parentheses,
// even though it is not immediately followed by a `)`.
FPp.hasParens = function () {
    var node = this.getNode();
    var prevToken = this.getPrevToken(node);
    if (!prevToken) {
        return false;
    }
    var nextToken = this.getNextToken(node);
    if (!nextToken) {
        return false;
    }
    if (prevToken.value === "(") {
        if (nextToken.value === ")") {
            // If the node preceded by a `(` token and followed by a `)` token,
            // then of course it has parentheses.
            return true;
        }
        // If this is one of the few Expression types that can't come first in
        // the enclosing statement because of parsing ambiguities (namely,
        // FunctionExpression, ObjectExpression, and ClassExpression) and
        // this.firstInStatement() returns true, and the node would not need
        // parentheses in an expression context because this.needsParens(true)
        // returns false, then it just needs an opening parenthesis to resolve
        // the parsing ambiguity that made it appear to need parentheses.
        var justNeedsOpeningParen = !this.canBeFirstInStatement() &&
            this.firstInStatement() &&
            !this.needsParens(true);
        if (justNeedsOpeningParen) {
            return true;
        }
    }
    return false;
};
FPp.getPrevToken = function (node) {
    node = node || this.getNode();
    var loc = node && fastPathOptionalLocation(node.loc);
    var tokens = loc && loc.tokens;
    if (tokens && loc!.start.token! > 0) {
        var token = tokens[loc!.start.token! - 1];
        if (token) {
            // Do not return tokens that fall outside the root subtree.
            var rootLoc = fastPathLocation(readProperty(this.getRootValue(), "loc"));
            if (util.comparePos(rootLoc.start, fastPathToken(token).loc.start) <= 0) {
                return fastPathToken(token);
            }
        }
    }
    return null;
};
FPp.getNextToken = function (node) {
    node = node || this.getNode();
    var loc = node && fastPathOptionalLocation(node.loc);
    var tokens = loc && loc.tokens;
    if (tokens && loc!.end.token! < tokens.length) {
        var token = tokens[loc!.end.token!];
        if (token) {
            // Do not return tokens that fall outside the root subtree.
            var rootLoc = fastPathLocation(readProperty(this.getRootValue(), "loc"));
            if (util.comparePos(fastPathToken(token).loc.end, rootLoc.end) <= 0) {
                return fastPathToken(token);
            }
        }
    }
    return null;
};
// Inspired by require("ast-types").NodePath.prototype.needsParens, but
// more efficient because we're iterating backwards through a stack.
FPp.needsParens = function (assumeExpressionContext) {
    var node = this.getNode()!;
    // This needs to come before `if (!parent) { return false }` because
    // an object destructuring assignment requires parens for
    // correctness even when it's the topmost expression.
    if (node.type === "AssignmentExpression" &&
        node.left.type === "ObjectPattern") {
        return true;
    }
    var parent = this.getParentNode();
    var name = this.getName();
    // If the value of this path is some child of a Node and not a Node
    // itself, then it doesn't need parentheses. Only Node objects (in fact,
    // only Expression nodes) need parentheses.
    if (this.getValue() !== node) {
        return false;
    }
    // Only statements don't need parentheses.
    if (n.Statement.check(node)) {
        return false;
    }
    // Identifiers never need parentheses.
    if (node.type === "Identifier") {
        return false;
    }
    if (parent && parent.type === "ParenthesizedExpression") {
        return false;
    }
    if (readProperty(node, "extra") && readProperty(readProperty(node, "extra"), "parenthesized")) {
        return true;
    }
    if (!parent)
        return false;
    // Wrap e.g. `-1` in parentheses inside `(-1) ** 2`.
    if (node.type === "UnaryExpression" &&
        parent.type === "BinaryExpression" &&
        name === "left" &&
        parent.left === node &&
        parent.operator === "**") {
        return true;
    }
    switch (node.type) {
        case "UnaryExpression":
        case "SpreadElement":
        case "SpreadProperty":
            return (parent.type === "MemberExpression" &&
                name === "object" &&
                parent.object === node);
        case "BinaryExpression":
        case "LogicalExpression":
            switch (parent.type) {
                case "CallExpression":
                    return name === "callee" && parent.callee === node;
                case "UnaryExpression":
                case "SpreadElement":
                case "SpreadProperty":
                    return true;
                case "MemberExpression":
                    return name === "object" && parent.object === node;
                case "BinaryExpression":
                case "LogicalExpression": {
                    var po = parent.operator;
                    var pp = PRECEDENCE[po];
                    var no = node.operator;
                    var np = PRECEDENCE[no];
                    if (pp > np) {
                        return true;
                    }
                    if (pp === np && name === "right") {
                        (0, tiny_invariant_1.default)(parent.right === node);
                        return true;
                    }
                    break;
                }
                default:
                    return false;
            }
            break;
        case "SequenceExpression":
            switch (parent.type) {
                case "ReturnStatement":
                    return false;
                case "ForStatement":
                    // Although parentheses wouldn't hurt around sequence expressions in
                    // the head of for loops, traditional style dictates that e.g. i++,
                    // j++ should not be wrapped with parentheses.
                    return false;
                case "ExpressionStatement":
                    return name !== "expression";
                default:
                    // Otherwise err on the side of overparenthesization, adding
                    // explicit exceptions above if this proves overzealous.
                    return true;
            }
        case "OptionalIndexedAccessType":
            return node.optional && parent.type === "IndexedAccessType";
        case "IntersectionTypeAnnotation":
        case "UnionTypeAnnotation":
            return parent.type === "NullableTypeAnnotation";
        case "Literal":
            return (parent.type === "MemberExpression" &&
                isNumber.check(node.value) &&
                name === "object" &&
                parent.object === node);
        // Babel 6 Literal split
        case "NumericLiteral":
            return (parent.type === "MemberExpression" &&
                name === "object" &&
                parent.object === node);
        case "YieldExpression":
        case "AwaitExpression":
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
                case "NewExpression":
                    return name === "callee" && parent.callee === node;
                case "ConditionalExpression":
                    return name === "test" && parent.test === node;
                case "MemberExpression":
                    return name === "object" && parent.object === node;
                default:
                    return false;
            }
        case "ArrowFunctionExpression":
            if (n.CallExpression.check(parent) &&
                name === "callee" &&
                parent.callee === node) {
                return true;
            }
            if (n.MemberExpression.check(parent) &&
                name === "object" &&
                parent.object === node) {
                return true;
            }
            if (n.TSAsExpression &&
                n.TSAsExpression.check(parent) &&
                name === "expression" &&
                parent.expression === node) {
                return true;
            }
            return isBinary(parent);
        case "ObjectExpression":
            if (parent.type === "ArrowFunctionExpression" &&
                name === "body" &&
                parent.body === node) {
                return true;
            }
            break;
        case "TSAsExpression":
            if (parent.type === "ArrowFunctionExpression" &&
                name === "body" &&
                parent.body === node &&
                node.expression.type === "ObjectExpression") {
                return true;
            }
            break;
        case "CallExpression":
            if (name === "declaration" &&
                n.ExportDefaultDeclaration.check(parent) &&
                n.FunctionExpression.check(node.callee)) {
                return true;
            }
    }
    if (parent.type === "NewExpression" &&
        name === "callee" &&
        parent.callee === node) {
        return containsCallExpression(node);
    }
    if (assumeExpressionContext !== true &&
        !this.canBeFirstInStatement() &&
        this.firstInStatement()) {
        return true;
    }
    return false;
};
function isBinary(node: unknown) {
    return n.BinaryExpression.check(node) || n.LogicalExpression.check(node);
}
// upstream JS type note: 'isUnaryLike' is declared but its value is never read. [6133]
function isUnaryLike(node: unknown) {
    return (n.UnaryExpression.check(node) ||
        // I considered making SpreadElement and SpreadProperty subtypes of
        // UnaryExpression, but they're not really Expression nodes.
        (n.SpreadElement && n.SpreadElement.check(node)) ||
        (n.SpreadProperty && n.SpreadProperty.check(node)));
}
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
FPp.canBeFirstInStatement = function () {
    var node = this.getNode();
    if (n.FunctionExpression.check(node)) {
        return false;
    }
    if (n.ObjectExpression.check(node)) {
        return false;
    }
    if (n.ClassExpression.check(node)) {
        return false;
    }
    return true;
};
FPp.firstInStatement = function () {
    var s = this.stack;
    var parentName: unknown, parent: unknown;
    var childName: unknown, child: unknown;
    for (var i = s.length - 1; i >= 0; i -= 2) {
        if (n.Node.check(s[i])) {
            childName = parentName;
            child = parent;
            parentName = s[i - 1];
            parent = s[i];
        }
        if (!parent || !child) {
            continue;
        }
        if (n.BlockStatement.check(parent) &&
            parentName === "body" &&
            childName === 0) {
            (0, tiny_invariant_1.default)(parent.body[0] === child);
            return true;
        }
        if (n.ExpressionStatement.check(parent) && childName === "expression") {
            (0, tiny_invariant_1.default)(parent.expression === child);
            return true;
        }
        if (n.AssignmentExpression.check(parent) && childName === "left") {
            (0, tiny_invariant_1.default)(parent.left === child);
            return true;
        }
        if (n.ArrowFunctionExpression.check(parent) && childName === "body") {
            (0, tiny_invariant_1.default)(parent.body === child);
            return true;
        }
        // s[i + 1] and s[i + 2] represent the array between the parent
        // SequenceExpression node and its child nodes
        if (n.SequenceExpression.check(parent) &&
            s[i + 1] === "expressions" &&
            childName === 0) {
            (0, tiny_invariant_1.default)(parent.expressions[0] === child);
            continue;
        }
        if (n.CallExpression.check(parent) && childName === "callee") {
            (0, tiny_invariant_1.default)(parent.callee === child);
            continue;
        }
        if (n.MemberExpression.check(parent) && childName === "object") {
            (0, tiny_invariant_1.default)(parent.object === child);
            continue;
        }
        if (n.ConditionalExpression.check(parent) && childName === "test") {
            (0, tiny_invariant_1.default)(parent.test === child);
            continue;
        }
        if (isBinary(parent) && childName === "left") {
            (0, tiny_invariant_1.default)(parent.left === child);
            continue;
        }
        if (n.UnaryExpression.check(parent) &&
            !parent.prefix &&
            childName === "argument") {
            (0, tiny_invariant_1.default)(parent.argument === child);
            continue;
        }
        return false;
    }
    return true;
};
function fastPathInstance(value: unknown): FastPath {
    if (value instanceof FastPath && Array.isArray(value.stack)) return value;
    throw new TypeError("Expected initialized FastPath");
}
function fastNodePath(value: unknown): RuntimePath {
    if (value instanceof types.Path) return value;
    throw new TypeError("Expected original AST path");
}
function fastPathName(value: unknown): PropertyKey | null | undefined {
    if (value === null || value === undefined || typeof value === "string" || typeof value === "number" || typeof value === "symbol") return value;
    throw new TypeError("Expected path property name");
}
function fastPathKey(value: unknown): PropertyKey {
    if (typeof value === "string" || typeof value === "number" || typeof value === "symbol") return value;
    throw new TypeError("Expected path property key");
}
function fastPathOptionalLocation(value: unknown): FastPathLocation | null | undefined {
    if (value === null || value === undefined) return value;
    return fastPathLocation(value);
}
function fastPathLocation(value: unknown): FastPathLocation {
    if (isFastPathLocation(value)) return value;
    throw new TypeError("Expected source location");
}
function isFastPathPosition(value: unknown): value is FastPathPosition {
    return isRecord(value) && typeof value.line === "number" && typeof value.column === "number" &&
        (value.token === undefined || typeof value.token === "number");
}
function isFastPathLocation(value: unknown): value is FastPathLocation {
    return isRecord(value) && isFastPathPosition(value.start) && isFastPathPosition(value.end) &&
        (value.tokens === undefined || Array.isArray(value.tokens));
}
function fastPathToken(value: unknown): FastPathToken {
    if (isFastPathToken(value)) return value;
    throw new TypeError("Expected source token");
}
function isFastPathToken(value: unknown): value is FastPathToken {
    return isRecord(value) && isFastPathLocation(value.loc);
}
exports["default"] = FastPath;


/***/ 
if (!exportsReady(exports, ["__esModule","default"])) throw new TypeError("Incomplete original module exports");
return exports;
}
