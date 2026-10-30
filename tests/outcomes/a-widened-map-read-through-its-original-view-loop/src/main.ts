// run: check
// A wide alias stores a string; this reads through the original numeric view.
// Control: tests/programs/array-from-widened-map-values, directOriginalViewLoop.
// Only the allocation's declared value type changes in that control.

export function throughOriginalViewLoop(n: number): string {
 const narrow = new Map<string, number>();
 const wide: Map<string, unknown> = narrow;
 wide.set("key", "copied:" + String(n));
 let result = ""; for (const value of narrow.values()) result += String(value); return result;
}
