import type {Lines} from "../../../types/recast/lib/lines.js";
import type * as K from "../../../types/ast-types/gen/kinds.js";
import type {RuntimeFastPath} from "../../../types/recast/runtime-fast-path.ts";
import {isSourceLocation, type SourceLocation} from "../../../types/recast/runtime-ast.ts";
// Exact module body from JetStream 3.0 ./node_modules/recast/lib/comments.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord, readProperty} from "../../../webpack.ts";
import {load as load0} from "../../tslib/tslib.es6.ts";
import {load as load1} from "../../tiny-invariant/dist/tiny-invariant.cjs.ts";
import {load as load2} from "../../ast-types/lib/main.ts";
import {load as load3} from "./lines.ts";
import {load as load4} from "./util.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for recast/lib/comments.js");
  return value;
 }
 return initialize();
}
function isExport(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> {
 return exportsReady(value, ["__esModule","attach","printComments"]);
}
function initialize() {
type Node = K.NodeKind;
type Comment = K.CommentKind & {
    loc?: SourceLocation | null;
    precedingNode?: Node;
    followingNode?: Node;
    enclosingNode?: Node;
};
type Print = (path: RuntimeFastPath) => Lines;

const exports: { __esModule?: true; "attach"?: typeof attach; "printComments"?: typeof printComments; } = {};
let module = {exports};
cache = module;


"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.printComments = exports.attach = void 0;
var tslib_1 = load0();
var tiny_invariant_1: {default: (condition: unknown, message?: string | (() => string)) => void} = tslib_1.__importDefault(load1());
var types = tslib_1.__importStar(load2());
var n = types.namedTypes;
var isArray = types.builtInTypes.array;
var isObject = types.builtInTypes.object;
var lines_1 = load3();
var util_1 = load4();
var childNodesCache: Pick<WeakMap<object, Node[]>, "set"> & {get(key: unknown): Node[] | undefined} = new WeakMap<object, Node[]>();
// TODO Move a non-caching implementation of this function into ast-types,
// and implement a caching wrapper function here.
function getSortedChildNodes(node: unknown, lines: Lines, resultArray?: Node[]): Node[] | undefined {
    if (!node) {
        return resultArray;
    }
    // The .loc checks below are sensitive to some of the problems that
    // are fixed by this utility function. Specifically, if it decides to
    // set node.loc to null, indicating that the node's .loc information
    // is unreliable, then we don't want to add node to the resultArray.
    (0, util_1.fixFaultyLocations)(node, lines);
    if (resultArray) {
        if (n.Node.check(node) && n.SourceLocation.check(node.loc)) {
            // This reverse insertion sort almost always takes constant
            // time because we almost always (maybe always?) append the
            // nodes in order anyway.
            var i = resultArray.length - 1;
            for (; i >= 0; --i) {
                var child = resultArray[i];
                if (child &&
                    child.loc &&
                    (0, util_1.comparePos)(child.loc!.end, node.loc.start) <= 0) {
                    break;
                }
            }
            resultArray.splice(i + 1, 0, node);
            return resultArray;
        }
    }
    else {
        var childNodes = childNodesCache.get(node);
        if (childNodes) {
            return childNodes;
        }
    }
    var names: string[];
    if (isArray.check(node)) {
        names = Object.keys(node);
    }
    else if (isObject.check(node)) {
        names = types.getFieldNames(node);
    }
    else {
        return resultArray;
    }
    if (!resultArray) {
        childNodesCache.set(node, (resultArray = []));
    }
    for (var i = 0, nameCount = names.length; i < nameCount; ++i) {
        getSortedChildNodes(readProperty(node, names[i]), lines, resultArray);
    }
    return resultArray;
}
// As efficiently as possible, decorate the comment object with
// .precedingNode, .enclosingNode, and/or .followingNode properties, at
// least one of which is guaranteed to be defined.
function decorateComment(node: unknown, comment: Comment, lines: Lines) {
    var childNodes = getSortedChildNodes(node, lines);
    // Time to dust off the old binary search robes and wizard hat.
    var left = 0;
    var right = childNodes && childNodes.length;
    var precedingNode: Node | undefined;
    var followingNode: Node | undefined;
    while (typeof right === "number" && left < right) {
        var middle = (left + right) >> 1;
        var child = childNodes![middle];
        if ((0, util_1.comparePos)(child.loc!.start, comment.loc!.start) <= 0 &&
            (0, util_1.comparePos)(comment.loc!.end, child.loc!.end) <= 0) {
            // The comment is completely contained by this child node.
            decorateComment((comment.enclosingNode = child), comment, lines);
            return; // Abandon the binary search at this level.
        }
        if ((0, util_1.comparePos)(child.loc!.end, comment.loc!.start) <= 0) {
            // This child node falls completely before the comment.
            // Because we will never consider this node or any nodes
            // before it again, this node must be the closest preceding
            // node we have encountered so far.
            precedingNode = child;
            left = middle + 1;
            continue;
        }
        if ((0, util_1.comparePos)(comment.loc!.end, child.loc!.start) <= 0) {
            // This child node falls completely after the comment.
            // Because we will never consider this node or any nodes after
            // it again, this node must be the closest following node we
            // have encountered so far.
            followingNode = child;
            right = middle;
            continue;
        }
        throw new Error("Comment location overlaps with node location");
    }
    if (precedingNode) {
        comment.precedingNode = precedingNode;
    }
    if (followingNode) {
        comment.followingNode = followingNode;
    }
}
function attach(comments: unknown, ast: unknown, lines: Lines) {
    if (!isArray.check(comments)) {
        return;
    }
    var tiesToBreak: Comment[] = [];
    comments.forEach(function (comment) {
        if (!isCommentLayout(comment)) throw new TypeError("Expected original comment layout");
        comment.loc!.lines = lines;
        decorateComment(ast, comment, lines);
        var pn = comment.precedingNode;
        var en = comment.enclosingNode;
        var fn = comment.followingNode;
        if (pn && fn) {
            var tieCount = tiesToBreak.length;
            if (tieCount > 0) {
                var lastTie = tiesToBreak[tieCount - 1];
                (0, tiny_invariant_1.default)((lastTie.precedingNode === comment.precedingNode) ===
                    (lastTie.followingNode === comment.followingNode));
                if (lastTie.followingNode !== comment.followingNode) {
                    breakTies(tiesToBreak, lines);
                }
            }
            tiesToBreak.push(comment);
        }
        else if (pn) {
            // No contest: we have a trailing comment.
            breakTies(tiesToBreak, lines);
            addTrailingComment(pn, comment);
        }
        else if (fn) {
            // No contest: we have a leading comment.
            breakTies(tiesToBreak, lines);
            addLeadingComment(fn, comment);
        }
        else if (en) {
            // The enclosing node has no child nodes at all, so what we
            // have here is a dangling comment, e.g. [/* crickets */].
            breakTies(tiesToBreak, lines);
            addDanglingComment(en, comment);
        }
        else {
            throw new Error("AST contains no nodes at all?");
        }
    });
    breakTies(tiesToBreak, lines);
    comments.forEach(function (comment) {
        if (!isCommentLayout(comment)) throw new TypeError("Expected original comment layout");
        // These node references were useful for breaking ties, but we
        // don't need them anymore, and they create cycles in the AST that
        // may lead to infinite recursion if we don't delete them here.
        delete comment.precedingNode;
        delete comment.enclosingNode;
        delete comment.followingNode;
    });
}
exports.attach = attach;
function breakTies(tiesToBreak: Comment[], lines: Lines) {
    var tieCount = tiesToBreak.length;
    if (tieCount === 0) {
        return;
    }
    var pn = tiesToBreak[0].precedingNode!;
    var fn = tiesToBreak[0].followingNode!;
    var gapEndPos = fn.loc!.start;
    // Iterate backwards through tiesToBreak, examining the gaps
    // between the tied comments. In order to qualify as leading, a
    // comment must be separated from fn by an unbroken series of
    // whitespace-only gaps (or other comments).
    var indexOfFirstLeadingComment = tieCount;
    var comment: Comment | undefined;
    for (; indexOfFirstLeadingComment > 0; --indexOfFirstLeadingComment) {
        comment = tiesToBreak[indexOfFirstLeadingComment - 1];
        (0, tiny_invariant_1.default)(comment.precedingNode === pn);
        (0, tiny_invariant_1.default)(comment.followingNode === fn);
        var gap = lines.sliceString(comment.loc!.end, gapEndPos);
        if (/\S/.test(gap)) {
            // The gap string contained something other than whitespace.
            break;
        }
        gapEndPos = comment.loc!.start;
    }
    while (indexOfFirstLeadingComment <= tieCount &&
        (comment = tiesToBreak[indexOfFirstLeadingComment]) &&
        // If the comment is a //-style comment and indented more
        // deeply than the node itself, reconsider it as trailing.
        (comment.type === "Line" || comment.type === "CommentLine") &&
        comment.loc!.start.column > fn.loc!.start.column) {
        ++indexOfFirstLeadingComment;
    }
    if (indexOfFirstLeadingComment) {
        var enclosingNode = tiesToBreak[indexOfFirstLeadingComment - 1].enclosingNode;
        if ((enclosingNode === null || enclosingNode === void 0 ? void 0 : enclosingNode.type) === "CallExpression") {
            --indexOfFirstLeadingComment;
        }
    }
    tiesToBreak.forEach(function (comment, i) {
        if (i < indexOfFirstLeadingComment) {
            addTrailingComment(pn, comment);
        }
        else {
            addLeadingComment(fn, comment);
        }
    });
    tiesToBreak.length = 0;
}
function addCommentHelper(node: Node, comment: Comment) {
    var comments = node.comments || (node.comments = []);
    comments.push(comment);
}
function addLeadingComment(node: Node, comment: Comment) {
    comment.leading = true;
    comment.trailing = false;
    addCommentHelper(node, comment);
}
function addDanglingComment(node: Node, comment: Comment) {
    comment.leading = false;
    comment.trailing = false;
    addCommentHelper(node, comment);
}
function addTrailingComment(node: Node, comment: Comment) {
    comment.leading = false;
    comment.trailing = true;
    addCommentHelper(node, comment);
}
function printLeadingComment(commentPath: RuntimeFastPath, print: Print) {
    var comment = commentLayout(commentPath.getValue());
    n.Comment.assert(comment);
    var loc = comment.loc;
    var lines = loc && loc.lines;
    var parts: unknown[] = [print(commentPath)];
    if (comment.trailing) {
        // When we print trailing comments as leading comments, we don't
        // want to bring any trailing spaces along.
        parts.push("\n");
    }
    else if (lines instanceof lines_1.Lines) {
        var trailingSpace = lines.slice(loc!.end, lines.skipSpaces(loc!.end) || lines.lastPos());
        if (trailingSpace.length === 1) {
            // If the trailing space contains no newlines, then we want to
            // preserve it exactly as we found it.
            parts.push(trailingSpace);
        }
        else {
            // If the trailing space contains newlines, then replace it
            // with just that many newlines, with all other spaces removed.
            parts.push(new Array(trailingSpace.length).join("\n"));
        }
    }
    else {
        parts.push("\n");
    }
    return (0, lines_1.concat)(parts);
}
function printTrailingComment(commentPath: RuntimeFastPath, print: Print) {
    var comment = commentLayout(commentPath.getValue(commentPath));
    n.Comment.assert(comment);
    var loc = comment.loc;
    var lines = loc && loc.lines;
    var parts: unknown[] = [];
    if (lines instanceof lines_1.Lines) {
        var fromPos = lines.skipSpaces(loc!.start, true) || lines.firstPos();
        var leadingSpace = lines.slice(fromPos, loc!.start);
        if (leadingSpace.length === 1) {
            // If the leading space contains no newlines, then we want to
            // preserve it exactly as we found it.
            parts.push(leadingSpace);
        }
        else {
            // If the leading space contains newlines, then replace it
            // with just that many newlines, sans all other spaces.
            parts.push(new Array(leadingSpace.length).join("\n"));
        }
    }
    parts.push(print(commentPath));
    return (0, lines_1.concat)(parts);
}
function printComments(path: RuntimeFastPath, print: Print) {
    var value = path.getValue();
    var innerLines = print(path);
    var comments = n.Node.check(value) && types.getFieldValue(value, "comments");
    if (!comments || readProperty(comments, "length") === 0) {
        return innerLines;
    }
    var leadingParts: unknown[] = [];
    var trailingParts = [innerLines];
    path.each(function (commentPath) {
        var comment = commentLayout(commentPath.getValue());
        var leading = types.getFieldValue(comment, "leading");
        var trailing = types.getFieldValue(comment, "trailing");
        if (leading ||
            (trailing &&
                !(n.Statement.check(value) ||
                    comment.type === "Block" ||
                    comment.type === "CommentBlock"))) {
            leadingParts.push(printLeadingComment(commentPath, print));
        }
        else if (trailing) {
            trailingParts.push(printTrailingComment(commentPath, print));
        }
    }, "comments");
    leadingParts.push.apply(leadingParts, trailingParts);
    return (0, lines_1.concat)(leadingParts);
}
exports.printComments = printComments;
function commentLayout(value: unknown): Comment {
    if (isCommentLayout(value)) return value;
    throw new TypeError("Expected original comment layout");
}
function isCommentLayout(value: unknown): value is Comment {
    if (!n.Comment.check(value)) return false;
    const preceding = readProperty(value, "precedingNode");
    const following = readProperty(value, "followingNode");
    const enclosing = readProperty(value, "enclosingNode");
    return (value.loc == null || isSourceLocation(value.loc)) &&
        (preceding === undefined || n.Node.check(preceding)) &&
        (following === undefined || n.Node.check(following)) &&
        (enclosing === undefined || n.Node.check(enclosing));
}



/***/ 
if (!exportsReady(exports, ["__esModule","attach","printComments"])) throw new TypeError("Incomplete original module exports");
return exports;
}
