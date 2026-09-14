/** @ntsAbi managed */
declare function bridge_text(v: string): string;
/** @ntsAbi managed */
declare function bridge_array(v: number[]): number[];
/** @ntsAbi managed */
declare function bridge_callback(v: (n: number) => number, n: number): number;
/** @ntsAbi managed */
declare function bridge_nested(v: unknown, n: number): number;
/** @ntsAbi managed */
declare function bridge_value(v: unknown): unknown;
/** @ntsAbi managed */
declare function bridge_object(v: { count: number }): void;
/** @ntsAbi managed */
declare function bridge_hidden(v: unknown): void;
/** @ntsAbi managed */
declare function bridge_bigint(v: bigint): bigint;
/** @ntsAbi managed */
declare function nts_checkpoint(): void;
export function run(n: number): number {
    nts_checkpoint();
    if (bridge_bigint(-18446744073709551619n) !== -18446744073709551612n) return -300;
    const text = bridge_text("α😀");
    const input = [n, 2.5];
    const array = bridge_array(input);
    if (input.length !== 3) return -200;
    const object = { count: 1 };
    bridge_object(object);
    const hidden = { hidden: 1 };
    bridge_hidden(n > 0 ? hidden : 42);
    const value = bridge_value(n);
    if (typeof value !== "number") return -100;
    return bridge_callback(v => v + 0.25, n) + value + array[1]
        + (text === "α😀" ? 1 : 0) + object.count + hidden.hidden
        + bridge_nested({ callback: (v: number) => v + 0.5 }, n);
}
