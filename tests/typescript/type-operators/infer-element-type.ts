/*---
description: `infer` extracts an element type and a return type; values typed by them come from the source at run time.
features: [ts-type-operators, ts-conditional-types, ts-infer]
---*/
type ElementOf<T> = T extends readonly (infer E)[] ? E : never;
type Result<F> = F extends (...args: never[]) => infer R ? R : never;
function last<T extends readonly unknown[]>(items: T): ElementOf<T> {
  return items[items.length - 1] as ElementOf<T>;
}
function build(): { ok: boolean; count: number } {
  return { ok: true, count: 2 };
}
const word: string = last(["a", "b", "c"]);
const built: Result<typeof build> = build();
assert.sameValue(word, "c");
assert.sameValue(built.count * 2, 4);
