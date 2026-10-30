// run: check
// A wide alias stores a string; this reads through the original numeric view.
// Control: tests/programs/array-from-widened-map-values, directOriginalViewCopy.
// Only the allocation's declared value type changes in that control.

export function throughOriginalViewCopy(n: number): string {
 const narrow = new Map<string, number>();
 const wide: Map<string, unknown> = narrow;
 wide.set("key", "copied:" + String(n));
 const held = Array.from(narrow.values()); wide.clear(); return String(held[0]);
}
