import type {namedTypes} from "../../../types/ast-types/gen/namedTypes.js";
import type * as K from "../../../types/ast-types/gen/kinds.js";
import type {Lines} from "../../../types/recast/lib/lines.js";
import type {RuntimeFastPath} from "../../../types/recast/runtime-fast-path.ts";
// Exact module body from JetStream 3.0 ./node_modules/recast/lib/util.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord, record, readProperty} from "../../../webpack.ts";
import {load as load0} from "../../tslib/tslib.es6.ts";
import {load as load1} from "../../tiny-invariant/dist/tiny-invariant.cjs.ts";
import {load as load2} from "../../ast-types/lib/main.ts";
import {load as load3} from "../../recast--source-map/source-map.ts";
import {load as load4} from "../../os-browserify/browser.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for recast/lib/util.js");
  return value;
 }
 return initialize();
}
function isExport(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> {
 return exportsReady(value, ["__esModule","getLineTerminator","isBrowser","getOption","getUnionOfKeys","comparePos","copyPos","composeSourceMaps","getTrueLoc","fixFaultyLocations","isExportDeclaration","getParentExportDeclaration","isTrailingCommaEnabled"]);
}
function initialize() {
const exports: { __esModule?: true; "getLineTerminator"?: typeof getLineTerminator; "isBrowser"?: typeof isBrowser; "getOption"?: typeof getOption; "getUnionOfKeys"?: typeof getUnionOfKeys; "comparePos"?: typeof comparePos; "copyPos"?: typeof copyPos; "composeSourceMaps"?: typeof composeSourceMaps; "getTrueLoc"?: typeof getTrueLoc; "fixFaultyLocations"?: typeof fixFaultyLocations; "isExportDeclaration"?: typeof isExportDeclaration; "getParentExportDeclaration"?: typeof getParentExportDeclaration; "isTrailingCommaEnabled"?: typeof isTrailingCommaEnabled; } = {};
let module = {exports};
cache = module;


"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.isTrailingCommaEnabled = exports.getParentExportDeclaration = exports.isExportDeclaration = exports.fixFaultyLocations = exports.getTrueLoc = exports.composeSourceMaps = exports.copyPos = exports.comparePos = exports.getUnionOfKeys = exports.getOption = exports.isBrowser = exports.getLineTerminator = void 0;
var tslib_1 = load0();
var tiny_invariant_1: {default: (condition: unknown, message?: string | (() => string)) => void} = tslib_1.__importDefault(load1());
var types = tslib_1.__importStar(load2());
var n = types.namedTypes;
var source_map_1 = tslib_1.__importDefault(load3());
var SourceMapConsumer = source_map_1.default.SourceMapConsumer;
var SourceMapGenerator = source_map_1.default.SourceMapGenerator;
var hasOwn = Object.prototype.hasOwnProperty;
function getLineTerminator() {
    return isBrowser() ? "\n" : (load4().EOL) || "\n";
}
exports.getLineTerminator = getLineTerminator;
function isBrowser() {
    return (typeof window !== "undefined" && typeof window.document !== "undefined");
}
exports.isBrowser = isBrowser;
function getOption(options: unknown, key: PropertyKey, defaultValue: unknown) {
    if (options && hasOwn.call(options, key)) {
        return readProperty(options, key);
    }
    return defaultValue;
}
exports.getOption = getOption;
function getUnionOfKeys(...args: unknown[]): Record<string, true>;
function getUnionOfKeys() {
    var args: unknown[] = [];
    for (var _i = 0; _i < arguments.length; _i++) {
        args[_i] = arguments[_i];
    }
    var result: Record<string, true> = {};
    var argc = args.length;
    for (var i = 0; i < argc; ++i) {
        var keys = Object.keys(utilKeyObject(args[i]));
        var keyCount = keys.length;
        for (var j = 0; j < keyCount; ++j) {
            result[keys[j]] = true;
        }
    }
    return result;
}
exports.getUnionOfKeys = getUnionOfKeys;
function comparePos(pos1: namedTypes.Position, pos2: namedTypes.Position) {
    return pos1.line - pos2.line || pos1.column - pos2.column;
}
exports.comparePos = comparePos;
function copyPos<L, C>(pos: {line: L; column: C}) {
    return {
        line: pos.line,
        column: pos.column,
    };
}
exports.copyPos = copyPos;
function composeSourceMaps(formerMap: unknown, latterMap: unknown) {
    if (formerMap) {
        if (!latterMap) {
            return formerMap;
        }
    }
    else {
        return latterMap || null;
    }
    var smcFormer = new SourceMapConsumer(formerMap);
    var smcLatter = new SourceMapConsumer(latterMap);
    var smg = new SourceMapGenerator({
        file: readProperty(latterMap, "file"),
        sourceRoot: readProperty(latterMap, "sourceRoot"),
    });
    var sourcesToContents: Record<string, unknown> = {};
    smcLatter.eachMapping(function (mapping) {
        var origPos = smcFormer.originalPositionFor({
            line: mapping.originalLine,
            column: mapping.originalColumn,
        });
        var sourceName = origPos.source;
        if (sourceName === null) {
            return;
        }
        smg.addMapping({
            source: sourceName,
            original: copyPos(origPos),
            generated: {
                line: mapping.generatedLine,
                column: mapping.generatedColumn,
            },
            name: mapping.name,
        });
        var sourceContent = smcFormer.sourceContentFor(sourceName);
        if (sourceContent && !hasOwn.call(sourcesToContents, sourceName)) {
            sourcesToContents[sourceName] = sourceContent;
            smg.setSourceContent(sourceName, sourceContent);
        }
    });
    return smg.toJSON();
}
exports.composeSourceMaps = composeSourceMaps;
function getTrueLoc(node: unknown, lines: Lines) {
    // It's possible that node is newly-created (not parsed by Esprima),
    // in which case it probably won't have a .loc property (or an
    // .original property for that matter). That's fine; we'll just
    // pretty-print it as usual.
    if (!readProperty(node, "loc")) {
        return null;
    }
    var result = {
        start: utilLocation(readProperty(node, "loc")).start,
        end: utilLocation(readProperty(node, "loc")).end,
    };
    function include(node: unknown) {
        expandLoc(result, readProperty(node, "loc"));
    }
    // If the node is an export declaration and its .declaration has any
    // decorators, their locations might contribute to the true start/end
    // positions of the export declaration node.
    if (readProperty(node, "declaration") &&
        readProperty(readProperty(node, "declaration"), "decorators") &&
        isExportDeclaration(node)) {
        utilArray(readProperty(readProperty(node, "declaration"), "decorators")).forEach(include);
    }
    if (comparePos(result.start, result.end) < 0) {
        // Trim leading whitespace.
        result.start = copyPos(result.start);
        lines.skipSpaces(result.start, false, true);
        if (comparePos(result.start, result.end) < 0) {
            // Trim trailing whitespace, if the end location is not already the
            // same as the start location.
            result.end = copyPos(result.end);
            lines.skipSpaces(result.end, true, true);
        }
    }
    // If the node has any comments, their locations might contribute to
    // the true start/end positions of the node.
    if (readProperty(node, "comments")) {
        utilArray(readProperty(node, "comments")).forEach(include);
    }
    return result;
}
exports.getTrueLoc = getTrueLoc;
function expandLoc(parentLoc: unknown, childLoc: unknown) {
    if (parentLoc && childLoc) {
        if (comparePos(utilLocation(childLoc).start, utilLocation(parentLoc).start) < 0) {
            utilLocation(parentLoc).start = utilLocation(childLoc).start;
        }
        if (comparePos(utilLocation(parentLoc).end, utilLocation(childLoc).end) < 0) {
            utilLocation(parentLoc).end = utilLocation(childLoc).end;
        }
    }
}
function fixFaultyLocations(node: unknown, lines: Lines) {
    var loc = readProperty(node, "loc");
    if (loc) {
        if (utilLocation(loc).start.line < 1) {
            utilLocation(loc).start.line = 1;
        }
        if (utilLocation(loc).end.line < 1) {
            utilLocation(loc).end.line = 1;
        }
    }
    if (readProperty(node, "type") === "File") {
        // Babylon returns File nodes whose .loc.{start,end} do not include
        // leading or trailing whitespace.
        utilLocation(loc).start = lines.firstPos();
        utilLocation(loc).end = lines.lastPos();
    }
    fixForLoopHead(node, lines);
    fixTemplateLiteral(node, lines);
    if (loc && readProperty(node, "decorators")) {
        // Expand the .loc of the node responsible for printing the decorators
        // (here, the decorated node) so that it includes node.decorators.
        utilArray(readProperty(node, "decorators")).forEach(function (decorator) {
            expandLoc(loc, readProperty(decorator, "loc"));
        });
    }
    else if (readProperty(node, "declaration") && isExportDeclaration(node)) {
        // Nullify .loc information for the child declaration so that we never
        // try to reprint it without also reprinting the export declaration.
        record(readProperty(node, "declaration")).loc = null;
        // Expand the .loc of the node responsible for printing the decorators
        // (here, the export declaration) so that it includes node.decorators.
        var decorators = readProperty(readProperty(node, "declaration"), "decorators");
        if (decorators) {
            utilArray(decorators).forEach(function (decorator) {
                expandLoc(loc, readProperty(decorator, "loc"));
            });
        }
    }
    else if ((n.MethodDefinition && n.MethodDefinition.check(node)) ||
        (n.Property.check(node) && (node.method || node.shorthand))) {
        // If the node is a MethodDefinition or a .method or .shorthand
        // Property, then the location information stored in
        // node.value.loc is very likely untrustworthy (just the {body}
        // part of a method, or nothing in the case of shorthand
        // properties), so we null out that information to prevent
        // accidental reuse of bogus source code during reprinting.
        record(node.value).loc = null;
        if (n.FunctionExpression.check(node.value)) {
            // FunctionExpression method values should be anonymous,
            // because their .id fields are ignored anyway.
            node.value.id = null;
        }
    }
    else if (readProperty(node, "type") === "ObjectTypeProperty") {
        var loc_1 = readProperty(node, "loc");
        var end = loc_1 && utilLocation(loc_1).end;
        if (end) {
            end = copyPos(utilPosition(end));
            if (lines.prevPos(utilPosition(end)) && lines.charAt(utilPosition(end)) === ",") {
                // Some parsers accidentally include trailing commas in the
                // .utilLocation(loc).end information for ObjectTypeProperty nodes.
                if ((end = lines.skipSpaces(utilPosition(end), true, true))) {
                    utilLocation(loc_1).end = utilPosition(end);
                }
            }
        }
    }
}
exports.fixFaultyLocations = fixFaultyLocations;
function fixForLoopHead(node: unknown, lines: Lines) {
    if (!isUtilForStatement(node)) {
        return;
    }
    function fix(child: unknown) {
        var loc = child && readProperty(child, "loc");
        var start = loc && utilLocation(loc).start;
        var end = loc && copyPos(utilLocation(loc).end);
        while (start && end && comparePos(utilPosition(start), utilPosition(end)) < 0) {
            lines.prevPos(utilPosition(end));
            if (lines.charAt(utilPosition(end)) === ";") {
                // Update child.loc.end to *exclude* the ';' character.
                utilLocation(loc).end.line = utilPosition(end).line;
                utilLocation(loc).end.column = utilPosition(end).column;
            }
            else {
                break;
            }
        }
    }
    fix(node.init);
    fix(node.test);
    fix(node.update);
}
function fixTemplateLiteral(node: unknown, lines: Lines) {
    if (!isUtilTemplateLiteral(node)) {
        return;
    }
    if (node.quasis.length === 0) {
        // If there are no quasi elements, then there is nothing to fix.
        return;
    }
    // node.loc is not present when using export default with a template literal
    if (node.loc) {
        // First we need to exclude the opening ` from the .loc of the first
        // quasi element, in case the parser accidentally decided to include it.
        var afterLeftBackTickPos = copyPos(node.loc.start);
        (0, tiny_invariant_1.default)(lines.charAt(afterLeftBackTickPos) === "`");
        (0, tiny_invariant_1.default)(lines.nextPos(afterLeftBackTickPos));
        var firstQuasi = node.quasis[0];
        if (comparePos(firstQuasi.loc!.start, afterLeftBackTickPos) < 0) {
            firstQuasi.loc!.start = afterLeftBackTickPos;
        }
        // Next we need to exclude the closing ` from the .loc of the last quasi
        // element, in case the parser accidentally decided to include it.
        var rightBackTickPos = copyPos(node.loc.end);
        (0, tiny_invariant_1.default)(lines.prevPos(rightBackTickPos));
        (0, tiny_invariant_1.default)(lines.charAt(rightBackTickPos) === "`");
        var lastQuasi = node.quasis[node.quasis.length - 1];
        if (comparePos(rightBackTickPos, lastQuasi.loc!.end) < 0) {
            lastQuasi.loc!.end = rightBackTickPos;
        }
    }
    // Now we need to exclude ${ and } characters from the .loc's of all
    // quasi elements, since some parsers accidentally include them.
    node.expressions.forEach(function (expr, i) {
        // Rewind from expr.loc!.start over any whitespace and the ${ that
        // precedes the expression. The position of the $ should be the same
        // as the .loc.end of the preceding quasi element, but some parsers
        // accidentally include the ${ in the .loc of the quasi element.
        var dollarCurlyPos = lines.skipSpaces(expr.loc!.start, true, false);
        if (lines.prevPos(dollarCurlyPos!) &&
            lines.charAt(dollarCurlyPos!) === "{" &&
            lines.prevPos(dollarCurlyPos!) &&
            lines.charAt(dollarCurlyPos!) === "$") {
            var quasiBefore = node.quasis[i];
            if (comparePos(dollarCurlyPos!, quasiBefore.loc!.end) < 0) {
                quasiBefore.loc!.end = dollarCurlyPos!;
            }
        }
        // Likewise, some parsers accidentally include the } that follows
        // the expression in the .loc of the following quasi element.
        var rightCurlyPos = lines.skipSpaces(expr.loc!.end, false, false);
        if (lines.charAt(rightCurlyPos!) === "}") {
            (0, tiny_invariant_1.default)(lines.nextPos(rightCurlyPos!));
            // Now rightCurlyPos is technically the position just after the }.
            var quasiAfter = node.quasis[i + 1];
            if (comparePos(quasiAfter.loc!.start, rightCurlyPos!) < 0) {
                quasiAfter.loc!.start = rightCurlyPos!;
            }
        }
    });
}
function isExportDeclaration(node: unknown) {
    if (node)
        switch (readProperty(node, "type")) {
            case "ExportDeclaration":
            case "ExportDefaultDeclaration":
            case "ExportDefaultSpecifier":
            case "DeclareExportDeclaration":
            case "ExportNamedDeclaration":
            case "ExportAllDeclaration":
                return true;
        }
    return false;
}
exports.isExportDeclaration = isExportDeclaration;
function getParentExportDeclaration(path: RuntimeFastPath) {
    var parentNode = path.getParentNode();
    if (path.getName() === "declaration" && isExportDeclaration(parentNode)) {
        return parentNode;
    }
    return null;
}
exports.getParentExportDeclaration = getParentExportDeclaration;
function isTrailingCommaEnabled(options: unknown, context: PropertyKey) {
    var trailingComma = readProperty(options, "trailingComma");
    if (typeof trailingComma === "object") {
        return !!readProperty(trailingComma, context);
    }
    return !!trailingComma;
}
exports.isTrailingCommaEnabled = isTrailingCommaEnabled;
function utilKeyObject(value: unknown): object {
    if (value === null || value === undefined) throw new TypeError("Cannot convert nullish value to object");
    const boxed: unknown = Object(value);
    return record(boxed);
}
function utilArray(value: unknown): unknown[] {
    if (Array.isArray(value)) return value;
    throw new TypeError("Expected AST field array");
}
function utilPosition(value: unknown): namedTypes.Position {
    if (isUtilPosition(value)) return value;
    throw new TypeError("Expected source position");
}
function isUtilPosition(value: unknown): value is namedTypes.Position {
    return isRecord(value) && typeof value.line === "number" && typeof value.column === "number";
}
function utilLocation(value: unknown): namedTypes.SourceLocation {
    if (isUtilLocation(value)) return value;
    throw new TypeError("Expected source location");
}
function isUtilLocation(value: unknown): value is namedTypes.SourceLocation {
    return isRecord(value) && isUtilPosition(value.start) && isUtilPosition(value.end) &&
        (value.source === undefined || value.source === null || typeof value.source === "string");
}
function isUtilForStatement(value: unknown): value is K.ForStatementKind {
    return readProperty(value, "type") === "ForStatement";
}
function isUtilTemplateLiteral(value: unknown): value is K.TemplateLiteralKind {
    return readProperty(value, "type") === "TemplateLiteral";
}



/***/ 
if (!exportsReady(exports, ["__esModule","getLineTerminator","isBrowser","getOption","getUnionOfKeys","comparePos","copyPos","composeSourceMaps","getTrueLoc","fixFaultyLocations","isExportDeclaration","getParentExportDeclaration","isTrailingCommaEnabled"])) throw new TypeError("Incomplete original module exports");
return exports;
}
