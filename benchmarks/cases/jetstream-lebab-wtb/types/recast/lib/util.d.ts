// Original Recast 0.23.11 declarations, MIT; arbitrary values are unknown.
export declare function getLineTerminator(): unknown;
export declare function isBrowser(): boolean;
export declare function getOption(options: unknown, key: unknown, defaultValue: unknown): unknown;
export declare function getUnionOfKeys(...args: unknown[]): unknown;
export declare function comparePos(pos1: unknown, pos2: unknown): number;
export declare function copyPos(pos: unknown): {
    line: unknown;
    column: unknown;
};
export declare function composeSourceMaps(formerMap: unknown, latterMap: unknown): unknown;
export declare function getTrueLoc(node: unknown, lines: unknown): {
    start: import("../../ast-types/gen/namedTypes.js").namedTypes.Position;
    end: import("../../ast-types/gen/namedTypes.js").namedTypes.Position;
} | null;
export declare function fixFaultyLocations(node: unknown, lines: unknown): void;
export declare function isExportDeclaration(node: unknown): boolean;
export declare function getParentExportDeclaration(path: unknown): unknown;
export declare function isTrailingCommaEnabled(options: unknown, context: unknown): boolean;
