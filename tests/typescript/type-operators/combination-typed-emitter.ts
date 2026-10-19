/*---
description: A generic event emitter whose event map flows through keyof, indexed access, mapped and template literal types.
features: [ts-type-operators, ts-keyof, ts-indexed-access, ts-mapped-types, ts-template-literal-types, ts-generics, ts-class]
---*/
type Events = { open: { path: string }; close: { code: number } };
type Listeners<E> = { [K in keyof E]?: ((payload: E[K]) => void)[] };
class Emitter<E> {
  private listeners: Listeners<E> = {};
  on<K extends keyof E>(event: K, listener: (payload: E[K]) => void): this {
    (this.listeners[event] ??= []).push(listener);
    return this;
  }
  emit<K extends keyof E & string>(event: K, payload: E[K]): `${K}:${number}` {
    const list = this.listeners[event] ?? [];
    for (const listener of list) listener(payload);
    return `${event}:${list.length}`;
  }
}
const seen: string[] = [];
const emitter = new Emitter<Events>().on("open", (p) => seen.push(p.path)).on("close", (p) => seen.push(`#${p.code}`));
assert.sameValue(emitter.emit("open", { path: "/a" }), "open:1");
assert.sameValue(emitter.emit("close", { code: 2 }), "close:1");
assert.compareArray(seen, ["/a", "#2"]);
