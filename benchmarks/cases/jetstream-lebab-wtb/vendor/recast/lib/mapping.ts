import type {namedTypes} from "../../../types/ast-types/gen/namedTypes.js";
import type {Lines} from "../../../types/recast/lib/lines.js";
// Exact module body from JetStream 3.0 ./node_modules/recast/lib/mapping.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord} from "../../../webpack.ts";
import {load as load0} from "../../tslib/tslib.es6.ts";
import {load as load1} from "../../tiny-invariant/dist/tiny-invariant.cjs.ts";
import {load as load2} from "./util.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for recast/lib/mapping.js");
  return value;
 }
 return initialize();
}
function isExport(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> {
 return exportsReady(value, ["__esModule","default"]);
}
function initialize() {
type Pos = namedTypes.Position;
type Loc = namedTypes.SourceLocation;

const exports: { __esModule?: true; "default"?: typeof Mapping; } = {};
let module = {exports};
cache = module;


"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
var tslib_1 = load0();
var tiny_invariant_1: {default: (condition: unknown, message?: string | (() => string)) => void} = tslib_1.__importDefault(load1());
var util_1 = load2();
class Mapping {
declare sourceLines: Lines;
declare sourceLoc: Loc;
declare targetLoc: Loc;
constructor(sourceLines: Lines, sourceLoc: Loc, targetLoc?: Loc) {
        if (targetLoc === void 0) { targetLoc = sourceLoc; }
        this.sourceLines = sourceLines;
        this.sourceLoc = sourceLoc;
        this.targetLoc = targetLoc;
    }
slice(lines: Lines, start: Pos, end?: Pos) {
        if (end === void 0) { end = lines.lastPos(); }
        var sourceLines = this.sourceLines;
        var sourceLoc = this.sourceLoc;
        var targetLoc = this.targetLoc;
        function skip(name: "start" | "end") {
            var sourceFromPos = sourceLoc[name];
            var targetFromPos = targetLoc[name];
            var targetToPos = start;
            if (name === "end") {
                targetToPos = end!;
            }
            else {
                (0, tiny_invariant_1.default)(name === "start");
            }
            return skipChars(sourceLines, sourceFromPos, lines, targetFromPos, targetToPos);
        }
        if ((0, util_1.comparePos)(start, targetLoc.start) <= 0) {
            if ((0, util_1.comparePos)(targetLoc.end, end) <= 0) {
                targetLoc = {
                    start: subtractPos(targetLoc.start, start.line, start.column),
                    end: subtractPos(targetLoc.end, start.line, start.column),
                };
                // The sourceLoc can stay the same because the contents of the
                // targetLoc have not changed.
            }
            else if ((0, util_1.comparePos)(end, targetLoc.start) <= 0) {
                return null;
            }
            else {
                sourceLoc = {
                    start: sourceLoc.start,
                    end: skip("end"),
                };
                targetLoc = {
                    start: subtractPos(targetLoc.start, start.line, start.column),
                    end: subtractPos(end, start.line, start.column),
                };
            }
        }
        else {
            if ((0, util_1.comparePos)(targetLoc.end, start) <= 0) {
                return null;
            }
            if ((0, util_1.comparePos)(targetLoc.end, end) <= 0) {
                sourceLoc = {
                    start: skip("start"),
                    end: sourceLoc.end,
                };
                targetLoc = {
                    // Same as subtractPos(start, start.line, start.column):
                    start: { line: 1, column: 0 },
                    end: subtractPos(targetLoc.end, start.line, start.column),
                };
            }
            else {
                sourceLoc = {
                    start: skip("start"),
                    end: skip("end"),
                };
                targetLoc = {
                    // Same as subtractPos(start, start.line, start.column):
                    start: { line: 1, column: 0 },
                    end: subtractPos(end, start.line, start.column),
                };
            }
        }
        return new Mapping(this.sourceLines, sourceLoc, targetLoc);
    }
add(line: number, column: number) {
        return new Mapping(this.sourceLines, this.sourceLoc, {
            start: addPos(this.targetLoc.start, line, column),
            end: addPos(this.targetLoc.end, line, column),
        });
    }
subtract(line: number, column: number) {
        return new Mapping(this.sourceLines, this.sourceLoc, {
            start: subtractPos(this.targetLoc.start, line, column),
            end: subtractPos(this.targetLoc.end, line, column),
        });
    }
indent(by: number, skipFirstLine?: boolean, noNegativeColumns?: boolean) {
        if (skipFirstLine === void 0) { skipFirstLine = false; }
        if (noNegativeColumns === void 0) { noNegativeColumns = false; }
        if (by === 0) {
            return this;
        }
        var targetLoc = this.targetLoc;
        var startLine = targetLoc.start.line;
        var endLine = targetLoc.end.line;
        if (skipFirstLine && startLine === 1 && endLine === 1) {
            return this;
        }
        targetLoc = {
            start: targetLoc.start,
            end: targetLoc.end,
        };
        if (!skipFirstLine || startLine > 1) {
            var startColumn = targetLoc.start.column + by;
            targetLoc.start = {
                line: startLine,
                column: noNegativeColumns ? Math.max(0, startColumn) : startColumn,
            };
        }
        if (!skipFirstLine || endLine > 1) {
            var endColumn = targetLoc.end.column + by;
            targetLoc.end = {
                line: endLine,
                column: noNegativeColumns ? Math.max(0, endColumn) : endColumn,
            };
        }
        return new Mapping(this.sourceLines, this.sourceLoc, targetLoc);
    }
}
exports["default"] = Mapping;
function addPos(toPos: Pos, line: number, column: number) {
    return {
        line: toPos.line + line - 1,
        column: toPos.line === 1 ? toPos.column + column : toPos.column,
    };
}
function subtractPos(fromPos: Pos, line: number, column: number) {
    return {
        line: fromPos.line - line + 1,
        column: fromPos.line === line ? fromPos.column - column : fromPos.column,
    };
}
function skipChars(sourceLines: Lines, sourceFromPos: Pos, targetLines: Lines, targetFromPos: Pos, targetToPos: Pos) {
    var targetComparison = (0, util_1.comparePos)(targetFromPos, targetToPos);
    if (targetComparison === 0) {
        // Trivial case: no characters to skip.
        return sourceFromPos;
    }
    var sourceCursor: Pos, targetCursor: Pos;
    if (targetComparison < 0) {
        // Skipping forward.
        sourceCursor =
            sourceLines.skipSpaces(sourceFromPos) || sourceLines.lastPos();
        targetCursor =
            targetLines.skipSpaces(targetFromPos) || targetLines.lastPos();
        var lineDiff = targetToPos.line - targetCursor.line;
        sourceCursor.line += lineDiff;
        targetCursor.line += lineDiff;
        if (lineDiff > 0) {
            // If jumping to later lines, reset columns to the beginnings
            // of those lines.
            sourceCursor.column = 0;
            targetCursor.column = 0;
        }
        else {
            (0, tiny_invariant_1.default)(lineDiff === 0);
        }
        while ((0, util_1.comparePos)(targetCursor, targetToPos) < 0 &&
            targetLines.nextPos(targetCursor, true)) {
            (0, tiny_invariant_1.default)(sourceLines.nextPos(sourceCursor, true));
            (0, tiny_invariant_1.default)(sourceLines.charAt(sourceCursor) === targetLines.charAt(targetCursor));
        }
    }
    else {
        // Skipping backward.
        sourceCursor =
            sourceLines.skipSpaces(sourceFromPos, true) || sourceLines.firstPos();
        targetCursor =
            targetLines.skipSpaces(targetFromPos, true) || targetLines.firstPos();
        var lineDiff = targetToPos.line - targetCursor.line;
        sourceCursor.line += lineDiff;
        targetCursor.line += lineDiff;
        if (lineDiff < 0) {
            // If jumping to earlier lines, reset columns to the ends of
            // those lines.
            sourceCursor.column = sourceLines.getLineLength(sourceCursor.line);
            targetCursor.column = targetLines.getLineLength(targetCursor.line);
        }
        else {
            (0, tiny_invariant_1.default)(lineDiff === 0);
        }
        while ((0, util_1.comparePos)(targetToPos, targetCursor) < 0 &&
            targetLines.prevPos(targetCursor, true)) {
            (0, tiny_invariant_1.default)(sourceLines.prevPos(sourceCursor, true));
            (0, tiny_invariant_1.default)(sourceLines.charAt(sourceCursor) === targetLines.charAt(targetCursor));
        }
    }
    return sourceCursor;
}


/***/ 
if (!exportsReady(exports, ["__esModule","default"])) throw new TypeError("Incomplete original module exports");
return exports;
}
