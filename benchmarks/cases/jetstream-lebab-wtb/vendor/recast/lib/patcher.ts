import type {Lines} from "../../../types/recast/lib/lines.js";
import type {RuntimeFastPath} from "../../../types/recast/runtime-fast-path.ts";
import {sourceLocation, type SourceLocation, type SourcePosition} from "../../../types/recast/runtime-ast.ts";
// Exact module body from JetStream 3.0 ./node_modules/recast/lib/patcher.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord, readProperty, record} from "../../../webpack.ts";
import {load as load0} from "../../tslib/tslib.es6.ts";
import {load as load1} from "../../tiny-invariant/dist/tiny-invariant.cjs.ts";
import {load as load2} from "./lines.ts";
import {load as load3} from "../../ast-types/lib/main.ts";
import {load as load4} from "./util.ts";
import {load as load5} from "./fast-path.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for recast/lib/patcher.js");
  return value;
 }
 return initialize();
}
function isExport(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> {
 return exportsReady(value, ["__esModule","Patcher","getReprinter"]);
}
function initialize() {
interface Reprint { oldPath: RuntimeFastPath; newPath: RuntimeFastPath; }
interface PrintOptions { includeComments?: boolean; avoidRootParens?: boolean; }
type Print = (path: RuntimeFastPath, options?: PrintOptions) => Lines;
interface PatcherType {
  replace(loc: SourceLocation, lines: string | Lines): void;
  get(loc?: SourceLocation | null): Lines;
  tryToReprintComments(newNode: unknown, oldNode: unknown, print: Print): boolean;
  deleteComments(node: unknown): void;
}
interface Replacement { lines: string | Lines; start: SourcePosition; end: SourcePosition; }

const exports: { __esModule?: true; "Patcher"?: typeof Patcher; "getReprinter"?: typeof getReprinter; } = {};
let module = {exports};
cache = module;


"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.getReprinter = exports.Patcher = void 0;
var tslib_1 = load0();
var tiny_invariant_1: {default: (condition: unknown, message?: string | (() => string)) => void} = tslib_1.__importDefault(load1());
var linesModule = tslib_1.__importStar(load2());
var types = tslib_1.__importStar(load3());
var Printable = types.namedTypes.Printable;
var Expression = types.namedTypes.Expression;
var ReturnStatement = types.namedTypes.ReturnStatement;
var SourceLocation = types.namedTypes.SourceLocation;
var util_1 = load4();
var fast_path_1 = tslib_1.__importDefault(load5());
var isObject = types.builtInTypes.object;
var isArray = types.builtInTypes.array;
var isString = types.builtInTypes.string;
var riskyAdjoiningCharExp = /[0-9a-z_$]/i;
class Patcher {
declare replace: (loc: SourceLocation, lines: string | Lines) => void;
declare get: (loc?: SourceLocation | null) => Lines;
declare tryToReprintComments: (newNode: unknown, oldNode: unknown, print: Print) => boolean;
declare deleteComments: (node: unknown) => void;

constructor(lines: Lines) {
    (0, tiny_invariant_1.default)(this instanceof Patcher);
    (0, tiny_invariant_1.default)(lines instanceof linesModule.Lines);
    var self = this, replacements: Replacement[] = [];
    self.replace = function (loc, lines) {
        if (isString.check(lines))
            lines = linesModule.fromString(lines);
        replacements.push({
            lines: lines,
            start: loc.start,
            end: loc.end,
        });
    };
    self.get = function (loc) {
        // If no location is provided, return the complete Lines object.
        loc = loc || {
            start: { line: 1, column: 0 },
            end: { line: lines.length, column: lines.getLineLength(lines.length) },
        };
        var sliceFrom = loc.start, toConcat: unknown[] = [];
        function pushSlice(from: SourcePosition, to: SourcePosition) {
            (0, tiny_invariant_1.default)((0, util_1.comparePos)(from, to) <= 0);
            toConcat.push(lines.slice(from, to));
        }
        replacements
            .sort(function (a, b) { return (0, util_1.comparePos)(a.start, b.start); })
            .forEach(function (rep) {
            if ((0, util_1.comparePos)(sliceFrom, rep.start) > 0) {
                // Ignore nested replacement ranges.
            }
            else {
                pushSlice(sliceFrom, rep.start);
                toConcat.push(rep.lines);
                sliceFrom = rep.end;
            }
        });
        pushSlice(sliceFrom, loc.end);
        return linesModule.concat(toConcat);
    };
}
}
exports.Patcher = Patcher;
var Pp: PatcherType = Patcher.prototype;
Pp.tryToReprintComments = function (newNode, oldNode, print) {
    var patcher = this;
    if (!readProperty(newNode, "comments") && !readProperty(oldNode, "comments")) {
        // We were (vacuously) able to reprint all the comments!
        return true;
    }
    var newPath = fast_path_1.default.from(newNode);
    var oldPath = fast_path_1.default.from(oldNode);
    newPath.stack.push("comments", getSurroundingComments(newNode));
    oldPath.stack.push("comments", getSurroundingComments(oldNode));
    var reprints: Reprint[] = [];
    var ableToReprintComments = findArrayReprints(newPath, oldPath, reprints);
    // No need to pop anything from newPath.stack or oldPath.stack, since
    // newPath and oldPath are fresh local variables.
    if (ableToReprintComments && reprints.length > 0) {
        reprints.forEach(function (reprint) {
            var oldComment = reprint.oldPath.getValue();
            (0, tiny_invariant_1.default)(readProperty(oldComment, "leading") || readProperty(oldComment, "trailing"));
            patcher.replace(sourceLocation(readProperty(oldComment, "loc")), 
            // Comments can't have .comments, so it doesn't matter whether we
            // print with comments or without.
            print(reprint.newPath).indentTail(sourceLocation(readProperty(oldComment, "loc")).indent!));
        });
    }
    return ableToReprintComments;
};
// Get all comments that are either leading or trailing, ignoring any
// comments that occur inside node.loc. Returns an empty array for nodes
// with no leading or trailing comments.
function getSurroundingComments(node: unknown) {
    var result: unknown[] = [];
    if (readProperty(node, "comments") && patcherArray(readProperty(node, "comments")).length > 0) {
        patcherArray(readProperty(node, "comments")).forEach(function (comment) {
            if (readProperty(comment, "leading") || readProperty(comment, "trailing")) {
                result.push(comment);
            }
        });
    }
    return result;
}
Pp.deleteComments = function (node) {
    if (!readProperty(node, "comments")) {
        return;
    }
    var patcher = this;
    patcherArray(readProperty(node, "comments")).forEach(function (comment) {
        if (readProperty(comment, "leading")) {
            // Delete leading comments along with any trailing whitespace they
            // might have.
            patcher.replace({
                start: sourceLocation(readProperty(comment, "loc")).start,
                end: patcherLines(sourceLocation(readProperty(node, "loc")).lines).skipSpaces(sourceLocation(readProperty(comment, "loc")).end, false, false)!,
            }, "");
        }
        else if (readProperty(comment, "trailing")) {
            // Delete trailing comments along with any leading whitespace they
            // might have.
            patcher.replace({
                start: patcherLines(sourceLocation(readProperty(node, "loc")).lines).skipSpaces(sourceLocation(readProperty(comment, "loc")).start, true, false)!,
                end: sourceLocation(readProperty(comment, "loc")).end,
            }, "");
        }
    });
};
function getReprinter(path: RuntimeFastPath) {
    (0, tiny_invariant_1.default)(path instanceof fast_path_1.default);
    // Make sure that this path refers specifically to a Node, rather than
    // some non-Node subproperty of a Node.
    var node = path.getValue();
    if (!Printable.check(node))
        return;
    var orig = readProperty(node, "original");
    var origLoc = orig && readProperty(orig, "loc");
    var lines = origLoc && sourceLocation(origLoc).lines;
    var reprints: Reprint[] = [];
    if (!lines || !findReprints(path, reprints))
        return;
    return function (print: Print) {
        var patcher = new Patcher(patcherLines(lines));
        reprints.forEach(function (reprint) {
            var newNode = reprint.newPath.getValue();
            var oldNode = reprint.oldPath.getValue();
            SourceLocation.assert(sourceLocation(readProperty(oldNode, "loc")), true);
            var needToPrintNewPathWithComments = !patcher.tryToReprintComments(newNode, oldNode, print);
            if (needToPrintNewPathWithComments) {
                // Since we were not able to preserve all leading/trailing
                // comments, we delete oldNode's comments, print newPath with
                // comments, and then patch the resulting lines where oldNode used
                // to be.
                patcher.deleteComments(oldNode);
            }
            var newLines = print(reprint.newPath, {
                includeComments: needToPrintNewPathWithComments,
                // If the oldNode we're replacing already had parentheses, we may
                // not need to print the new node with any extra parentheses,
                // because the existing parentheses will suffice. However, if the
                // newNode has a different type than the oldNode, let the printer
                // decide if reprint.newPath needs parentheses, as usual.
                avoidRootParens: readProperty(oldNode, "type") === readProperty(newNode, "type") && reprint.oldPath.hasParens(),
            }).indentTail(sourceLocation(readProperty(oldNode, "loc")).indent!);
            var nls = needsLeadingSpace(patcherLines(lines), sourceLocation(readProperty(oldNode, "loc")), newLines);
            var nts = needsTrailingSpace(patcherLines(lines), sourceLocation(readProperty(oldNode, "loc")), newLines);
            // If we try to replace the argument of a ReturnStatement like
            // return"asdf" with e.g. a literal null expression, we run the risk
            // of ending up with returnnull, so we need to add an extra leading
            // space in situations where that might happen. Likewise for
            // "asdf"in obj. See #170.
            if (nls || nts) {
                var newParts: (string | Lines)[] = [];
                nls && newParts.push(" ");
                newParts.push(newLines);
                nts && newParts.push(" ");
                newLines = linesModule.concat(newParts);
            }
            patcher.replace(sourceLocation(readProperty(oldNode, "loc")), newLines);
        });
        // Recall that origLoc is the .loc of an ancestor node that is
        // guaranteed to contain all the reprinted nodes and comments.
        var patchedLines = patcher.get(sourceLocation(origLoc)).indentTail(-sourceLocation(readProperty(orig, "loc")).indent!);
        if (path.needsParens()) {
            return linesModule.concat(["(", patchedLines, ")"]);
        }
        return patchedLines;
    };
}
exports.getReprinter = getReprinter;
function patcherArray(value: unknown): unknown[] {
    if (Array.isArray(value)) return value;
    throw new TypeError("Expected original AST array");
}
function patcherLines(value: unknown): Lines {
    if (value instanceof linesModule.Lines) return value;
    throw new TypeError("Expected original source Lines");
}

// If the last character before oldLoc and the first character of newLines
// are both identifier characters, they must be separated by a space,
// otherwise they will most likely get fused together into a single token.
function needsLeadingSpace(oldLines: Lines, oldLoc: SourceLocation, newLines: Lines) {
    var posBeforeOldLoc = (0, util_1.copyPos)(oldLoc.start);
    // The character just before the location occupied by oldNode.
    var charBeforeOldLoc = oldLines.prevPos(posBeforeOldLoc) && oldLines.charAt(posBeforeOldLoc);
    // First character of the reprinted node.
    var newFirstChar = newLines.charAt(newLines.firstPos());
    return (charBeforeOldLoc &&
        riskyAdjoiningCharExp.test(charBeforeOldLoc) &&
        newFirstChar &&
        riskyAdjoiningCharExp.test(newFirstChar));
}
// If the last character of newLines and the first character after oldLoc
// are both identifier characters, they must be separated by a space,
// otherwise they will most likely get fused together into a single token.
function needsTrailingSpace(oldLines: Lines, oldLoc: SourceLocation, newLines: Lines) {
    // The character just after the location occupied by oldNode.
    var charAfterOldLoc = oldLines.charAt(oldLoc.end);
    var newLastPos = newLines.lastPos();
    // Last character of the reprinted node.
    var newLastChar = newLines.prevPos(newLastPos) && newLines.charAt(newLastPos);
    return (newLastChar &&
        riskyAdjoiningCharExp.test(newLastChar) &&
        charAfterOldLoc &&
        riskyAdjoiningCharExp.test(charAfterOldLoc));
}
function findReprints(newPath: RuntimeFastPath, reprints: Reprint[]): boolean {
    var newNode = newPath.getValue();
    Printable.assert(newNode);
    var oldNode = readProperty(newNode, "original");
    Printable.assert(oldNode);
    (0, tiny_invariant_1.default)(reprints.length === 0);
    if (readProperty(newNode, "type") !== readProperty(oldNode, "type")) {
        return false;
    }
    var oldPath = new fast_path_1.default(oldNode);
    var canReprint = findChildReprints(newPath, oldPath, reprints);
    if (!canReprint) {
        // Make absolutely sure the calling code does not attempt to reprint
        // any nodes.
        reprints.length = 0;
    }
    return canReprint;
}
function findAnyReprints(newPath: RuntimeFastPath, oldPath: RuntimeFastPath, reprints: Reprint[]): boolean {
    var newNode = newPath.getValue();
    var oldNode = oldPath.getValue();
    if (newNode === oldNode)
        return true;
    if (isArray.check(newNode))
        return findArrayReprints(newPath, oldPath, reprints);
    if (isObject.check(newNode))
        return findObjectReprints(newPath, oldPath, reprints);
    return false;
}
function findArrayReprints(newPath: RuntimeFastPath, oldPath: RuntimeFastPath, reprints: Reprint[]): boolean {
    var newNode = newPath.getValue();
    var oldNode = oldPath.getValue();
    if (newNode === oldNode ||
        newPath.valueIsDuplicate() ||
        oldPath.valueIsDuplicate()) {
        return true;
    }
    isArray.assert(newNode);
    var len = patcherArray(newNode).length;
    if (!(isArray.check(oldNode) && oldNode.length === len))
        return false;
    for (var i = 0; i < len; ++i) {
        newPath.stack.push(i, patcherArray(newNode)[i]);
        oldPath.stack.push(i, oldNode[i]);
        var canReprint = findAnyReprints(newPath, oldPath, reprints);
        newPath.stack.length -= 2;
        oldPath.stack.length -= 2;
        if (!canReprint) {
            return false;
        }
    }
    return true;
}
function findObjectReprints(newPath: RuntimeFastPath, oldPath: RuntimeFastPath, reprints: Reprint[]): boolean {
    var newNode = newPath.getValue();
    isObject.assert(newNode);
    if (readProperty(newNode, "original") === null) {
        // If readProperty(newNode, "original") node was set to null, reprint the node.
        return false;
    }
    var oldNode = oldPath.getValue();
    if (!isObject.check(oldNode))
        return false;
    if (newNode === oldNode ||
        newPath.valueIsDuplicate() ||
        oldPath.valueIsDuplicate()) {
        return true;
    }
    if (Printable.check(newNode)) {
        if (!Printable.check(oldNode)) {
            return false;
        }
        var newParentNode = newPath.getParentNode();
        var oldParentNode = oldPath.getParentNode();
        if (oldParentNode !== null &&
            oldParentNode.type === "FunctionTypeAnnotation" &&
            newParentNode !== null &&
            newParentNode.type === "FunctionTypeAnnotation") {
            var oldNeedsParens = oldParentNode.params.length !== 1 || !!oldParentNode.params[0].name;
            var newNeedParens = newParentNode.params.length !== 1 || !!newParentNode.params[0].name;
            if (!oldNeedsParens && newNeedParens) {
                return false;
            }
        }
        // Here we need to decide whether the reprinted code for newNode is
        // appropriate for patching into the location of oldNode.
        if (readProperty(newNode, "type") === readProperty(oldNode, "type")) {
            var childReprints: Reprint[] = [];
            if (findChildReprints(newPath, oldPath, childReprints)) {
                reprints.push.apply(reprints, childReprints);
            }
            else if (readProperty(oldNode, "loc")) {
                // If we have no .loc information for oldNode, then we won't be
                // able to reprint it.
                reprints.push({
                    oldPath: oldPath.copy(),
                    newPath: newPath.copy(),
                });
            }
            else {
                return false;
            }
            return true;
        }
        if (Expression.check(newNode) &&
            Expression.check(oldNode) &&
            // If we have no .loc information for oldNode, then we won't be
            // able to reprint it.
            readProperty(oldNode, "loc")) {
            // If both nodes are subtypes of Expression, then we should be able
            // to fill the location occupied by the old node with code printed
            // for the new node with no ill consequences.
            reprints.push({
                oldPath: oldPath.copy(),
                newPath: newPath.copy(),
            });
            return true;
        }
        // The nodes have different types, and at least one of the types is
        // not a subtype of the Expression type, so we cannot safely assume
        // the nodes are syntactically interchangeable.
        return false;
    }
    return findChildReprints(newPath, oldPath, reprints);
}
function findChildReprints(newPath: RuntimeFastPath, oldPath: RuntimeFastPath, reprints: Reprint[]): boolean {
    var newNode = newPath.getValue();
    var oldNode = oldPath.getValue();
    isObject.assert(newNode);
    isObject.assert(oldNode);
    if (readProperty(newNode, "original") === null) {
        // If readProperty(newNode, "original") node was set to null, reprint the node.
        return false;
    }
    // If this node needs parentheses and will not be wrapped with
    // parentheses when reprinted, then return false to skip reprinting and
    // let it be printed generically.
    if (newPath.needsParens() && !oldPath.hasParens()) {
        return false;
    }
    var keys = (0, util_1.getUnionOfKeys)(oldNode, newNode);
    if (readProperty(oldNode, "type") === "File" || readProperty(newNode, "type") === "File") {
        // Don't bother traversing file.tokens, an often very large array
        // returned by Babylon, and useless for our purposes.
        delete keys.tokens;
    }
    // Don't bother traversing .loc objects looking for reprintable nodes.
    delete keys.loc;
    var originalReprintCount = reprints.length;
    for (var k in keys) {
        if (k.charAt(0) === "_") {
            // Ignore "private" AST properties added by e.g. Babel plugins and
            // parsers like Babylon.
            continue;
        }
        newPath.stack.push(k, types.getFieldValue(newNode, k));
        oldPath.stack.push(k, types.getFieldValue(oldNode, k));
        var canReprint = findAnyReprints(newPath, oldPath, reprints);
        newPath.stack.length -= 2;
        oldPath.stack.length -= 2;
        if (!canReprint) {
            return false;
        }
    }
    // Return statements might end up running into ASI issues due to
    // comments inserted deep within the tree, so reprint them if anything
    // changed within them.
    if (ReturnStatement.check(newPath.getNode()) &&
        reprints.length > originalReprintCount) {
        return false;
    }
    return true;
}


/***/ 
if (!exportsReady(exports, ["__esModule","Patcher","getReprinter"])) throw new TypeError("Incomplete original module exports");
return exports;
}
