// Original Recast 0.23.11 declarations, MIT; arbitrary values are unknown.
export interface PrintResultType {
    code: string;
    map?: unknown;
    toString(): string;
}
interface PrinterType {
    print(ast: unknown): PrintResultType;
    printGenerically(ast: unknown): PrintResultType;
}
interface PrinterConstructor {
    new (config?: unknown): PrinterType;
}
declare const Printer: PrinterConstructor;
export { Printer };
