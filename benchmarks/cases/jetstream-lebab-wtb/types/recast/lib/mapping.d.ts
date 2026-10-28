// Original Recast 0.23.11 declarations, MIT; arbitrary values are unknown.
import { namedTypes } from "../../ast-types/gen/namedTypes.js";
import { Lines } from "./lines.js";
type Pos = namedTypes.Position;
type Loc = namedTypes.SourceLocation;
export default class Mapping {
    sourceLines: Lines;
    sourceLoc: Loc;
    targetLoc: Loc;
    constructor(sourceLines: Lines, sourceLoc: Loc, targetLoc?: Loc);
    slice(lines: Lines, start: Pos, end?: Pos): Mapping | null;
    add(line: number, column: number): Mapping;
    subtract(line: number, column: number): Mapping;
    indent(by: number, skipFirstLine?: boolean, noNegativeColumns?: boolean): Mapping;
}
export {};
