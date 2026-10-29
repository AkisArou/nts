// Original Recast 0.23.11 declarations, MIT; arbitrary values are unknown.
interface PatcherType {
    replace(loc: unknown, lines: unknown): unknown;
    get(loc?: unknown): unknown;
    tryToReprintComments(newNode: unknown, oldNode: unknown, print: unknown): unknown;
    deleteComments(node: unknown): unknown;
}
interface PatcherConstructor {
    new (lines: unknown): PatcherType;
}
declare const Patcher: PatcherConstructor;
export { Patcher };
export declare function getReprinter(path: unknown): ((print: unknown) => unknown) | undefined;
