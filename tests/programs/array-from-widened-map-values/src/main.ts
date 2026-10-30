// run: check
// Each through/direct pair changes only the allocation's declared value type.
// Both views share tagged entries; copying or visiting a wide view preserves them.
// Original narrow-view subjects remain recorded in tests/outcomes; their direct controls stay here.

export function throughWide(n: number): string {
  const narrow = new Map<string, number>();
  const wide: Map<string, unknown> = narrow;
  wide.set("key", "copied:" + String(n));
  const held = Array.from(wide.values());
  wide.clear();
  return String(held[0]);
}

export function directWide(n: number): string {
  const narrow = new Map<string, unknown>();
  const wide: Map<string, unknown> = narrow;
  wide.set("key", "copied:" + String(n));
  const held = Array.from(wide.values());
  wide.clear();
  return String(held[0]);
}

export function throughSpread(n: number): string {
 const narrow = new Map<string, number>();
 const wide: Map<string, unknown> = narrow;
 wide.set("key", "copied:" + String(n));
 const held = [...wide.values()]; wide.clear(); return String(held[0]);
}

export function directSpread(n: number): string {
 const narrow = new Map<string, unknown>();
 const wide: Map<string, unknown> = narrow;
 wide.set("key", "copied:" + String(n));
 const held = [...wide.values()]; wide.clear(); return String(held[0]);
}

export function throughMapped(n: number): string {
 const narrow = new Map<string, number>();
 const wide: Map<string, unknown> = narrow;
 wide.set("key", "copied:" + String(n));
 const held = Array.from(wide.values(), value => String(value)); wide.clear(); return held[0]!;
}

export function directMapped(n: number): string {
 const narrow = new Map<string, unknown>();
 const wide: Map<string, unknown> = narrow;
 wide.set("key", "copied:" + String(n));
 const held = Array.from(wide.values(), value => String(value)); wide.clear(); return held[0]!;
}

export function throughEntries(n: number): string {
 const narrow = new Map<string, number>();
 const wide: Map<string, unknown> = narrow;
 wide.set("key", "copied:" + String(n));
 const held = Array.from(wide.entries()); wide.clear(); return String(held[0]![1]);
}

export function directEntries(n: number): string {
 const narrow = new Map<string, unknown>();
 const wide: Map<string, unknown> = narrow;
 wide.set("key", "copied:" + String(n));
 const held = Array.from(wide.entries()); wide.clear(); return String(held[0]![1]);
}

export function throughBare(n: number): string {
 const narrow = new Map<string, number>();
 const wide: Map<string, unknown> = narrow;
 wide.set("key", "copied:" + String(n));
 const held = Array.from(wide); wide.clear(); return String(held[0]![1]);
}

export function directBare(n: number): string {
 const narrow = new Map<string, unknown>();
 const wide: Map<string, unknown> = narrow;
 wide.set("key", "copied:" + String(n));
 const held = Array.from(wide); wide.clear(); return String(held[0]![1]);
}

export function throughEntriesSpread(n: number): string {
 const narrow = new Map<string, number>();
 const wide: Map<string, unknown> = narrow;
 wide.set("key", "copied:" + String(n));
 const held = [...wide.entries()]; wide.clear(); return String(held[0]![1]);
}

export function directEntriesSpread(n: number): string {
 const narrow = new Map<string, unknown>();
 const wide: Map<string, unknown> = narrow;
 wide.set("key", "copied:" + String(n));
 const held = [...wide.entries()]; wide.clear(); return String(held[0]![1]);
}

export function throughValuesLoop(n: number): string {
 const narrow = new Map<string, number>();
 const wide: Map<string, unknown> = narrow;
 wide.set("key", "copied:" + String(n));
 let result = ""; for (const value of wide.values()) result += String(value); return result;
}

export function directValuesLoop(n: number): string {
 const narrow = new Map<string, unknown>();
 const wide: Map<string, unknown> = narrow;
 wide.set("key", "copied:" + String(n));
 let result = ""; for (const value of wide.values()) result += String(value); return result;
}

export function throughPairsLoop(n: number): string {
 const narrow = new Map<string, number>();
 const wide: Map<string, unknown> = narrow;
 wide.set("key", "copied:" + String(n));
 let result = ""; for (const [, value] of wide) result += String(value); return result;
}

export function directPairsLoop(n: number): string {
 const narrow = new Map<string, unknown>();
 const wide: Map<string, unknown> = narrow;
 wide.set("key", "copied:" + String(n));
 let result = ""; for (const [, value] of wide) result += String(value); return result;
}

export function throughEntriesLoop(n: number): string {
 const narrow = new Map<string, number>();
 const wide: Map<string, unknown> = narrow;
 wide.set("key", "copied:" + String(n));
 let result = ""; for (const [, value] of wide.entries()) result += String(value); return result;
}

export function directEntriesLoop(n: number): string {
 const narrow = new Map<string, unknown>();
 const wide: Map<string, unknown> = narrow;
 wide.set("key", "copied:" + String(n));
 let result = ""; for (const [, value] of wide.entries()) result += String(value); return result;
}

export function throughForEach(n: number): string {
 const narrow = new Map<string, number>();
 const wide: Map<string, unknown> = narrow;
 wide.set("key", "copied:" + String(n));
 let result = ""; wide.forEach(value => { result = String(value); }); return result;
}

export function directForEach(n: number): string {
 const narrow = new Map<string, unknown>();
 const wide: Map<string, unknown> = narrow;
 wide.set("key", "copied:" + String(n));
 let result = ""; wide.forEach(value => { result = String(value); }); return result;
}

export function directOriginalViewLoop(n: number): string {
 const narrow = new Map<string, unknown>();
 const wide: Map<string, unknown> = narrow;
 wide.set("key", "copied:" + String(n));
 let result = ""; for (const value of narrow.values()) result += String(value); return result;
}

export function directOriginalViewCopy(n: number): string {
 const narrow = new Map<string, unknown>();
 const wide: Map<string, unknown> = narrow;
 wide.set("key", "copied:" + String(n));
 const held = Array.from(narrow.values()); wide.clear(); return String(held[0]);
}
