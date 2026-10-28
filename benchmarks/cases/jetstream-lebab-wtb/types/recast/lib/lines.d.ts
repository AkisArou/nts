// Original Recast 0.23.11 declarations, MIT; arbitrary values are unknown.
import { Options } from "./options.js";
import { namedTypes } from "../../ast-types/gen/namedTypes.js";
type Pos = namedTypes.Position;
type LineInfo = {
    readonly line: string;
    readonly indent: number;
    readonly locked: boolean;
    readonly sliceStart: number;
    readonly sliceEnd: number;
};
export declare class Lines {
    infos: LineInfo[];
    readonly length: number;
    readonly name: string | null;
    mappings: import("./mapping.js").default[];
    cachedSourceMap: {toJSON(): unknown} | null;
    cachedTabWidth: number | void;
    constructor(infos: LineInfo[], sourceFileName?: string | null);
    toString(options?: Options): string;
    getSourceMap(sourceMapName: string | null | undefined, sourceRoot?: string | null): unknown;
    bootstrapCharAt(pos: Pos): string;
    charAt(pos: Pos): string;
    stripMargin(width: number, skipFirstLine: boolean): Lines;
    indent(by: number): Lines;
    indentTail(by: number): Lines;
    lockIndentTail(): Lines;
    getIndentAt(line: number): number;
    guessTabWidth(): number;
    startsWithComment(): boolean;
    isOnlyWhitespace(): boolean;
    isPrecededOnlyByWhitespace(pos: Pos): boolean;
    getLineLength(line: number): number;
    nextPos(pos: Pos, skipSpaces?: boolean): boolean;
    prevPos(pos: Pos, skipSpaces?: boolean): boolean;
    firstPos(): {
        line: number;
        column: number;
    };
    lastPos(): {
        line: number;
        column: number;
    };
    skipSpaces(pos: Pos, backward?: boolean, modifyInPlace?: boolean): namedTypes.Position | null;
    trimLeft(): Lines;
    trimRight(): Lines;
    trim(): Lines;
    eachPos(callback: (pos: Pos) => unknown, startPos?: Pos, skipSpaces?: boolean): void;
    bootstrapSlice(start: Pos, end: Pos): Lines;
    slice(start?: Pos, end?: Pos): Lines;
    bootstrapSliceString(start: Pos, end: Pos, options?: Options): string;
    sliceString(start?: Pos, end?: Pos, options?: Options): string;
    isEmpty(): boolean;
    join(elements: unknown[]): Lines;
    concat(...args: unknown[]): Lines;
}
export declare function countSpaces(spaces: string, tabWidth?: number): number;
/**
 * @param {Object} options - Options object that configures printing.
 */
export declare function fromString(string: unknown, options?: Options): Lines;
export declare function concat(elements: unknown[]): Lines;
export {};
