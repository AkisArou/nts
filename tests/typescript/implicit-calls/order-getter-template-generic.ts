/*---
description: Template interpolation reads a generically constrained getter before invoking the returned object toString.
features: [ts-implicit-order, ts-accessors, ts-conversions, ts-to-string, ts-template-literals, ts-class, ts-class-fields, ts-interfaces, ts-generics, ts-generic-constraints]
---*/
// Route: generic getter followed by toString in a template literal; node preserves the complete hook order and state.
interface TextHook { toString(): string; }
interface Source { readonly item: TextHook; readItem(): TextHook; }
const log: string[] = [];
let state = 0;
class Text implements TextHook {
  value: number;
  constructor(value: number) { this.value = value; }
  toString(): string { state += 10; log.push(`toString:${this.value}:${state}`); return `v=${this.value}`; }
}
class Holder implements Source {
  value: number; stored: TextHook;
  constructor(value: number) { this.value = value; this.stored = new Text(value); }
  readItem(): TextHook { state++; log.push(`get:${this.value}:${state}`); return this.stored; }
  get item(): TextHook { return this.readItem(); }
}
function render<T extends Source>(source: T): string { return `(${source.item})`; }
for (const n of [-2, 0, 3]) {
  log.length = 0; state = 0;
  const result = render(new Holder(n));
  assert.sameValue(result, `(v=${n})`);
  assert.sameValue(state, 11);
  assert.compareArray(log, [`get:${n}:1`, `toString:${n}:11`]);
}
