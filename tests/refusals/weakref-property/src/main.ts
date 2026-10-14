// expect: NTS1001 a property `#map` of unrepresentable type (`Map<string, `WeakRef`>`)
//
// A `WeakRef` as a type argument. `Map` itself is representable here -- the two
// sibling fields below use one and are not refused -- so this is `WeakRef`
// alone, not the container it sits in.
//
// `typescript.md` §16 puts `WeakRef` and `FinalizationRegistry` in the **gap**
// column rather than the not-a-goal column, so this is a blocker rather than a
// declared limit, and it had no fixture.
//
// It is the whole of `diagnostics_channel`. That module builds and publishes
// **zero of its seven exports**; every one is refused through this field. The
// registry cannot be written any other way and stay correct: node's own
// `diagnostics_channel` holds channels weakly precisely so a long-running
// process that names channels dynamically does not leak one per name, and a
// strong map leaks forever. The `FinalizationRegistry` beside it clears the
// entry only when nothing has taken the name in the meantime, because
// finalization is not synchronous with collection.
//
// So this is not a shape that can be avoided by writing the module differently.
// A `Map<string, Channel>` compiles and is a different program.

class Channel {
  readonly name: string;
  constructor(name: string) {
    this.name = name;
  }
}

class Registry {
  // Refused.
  #map = new Map<string, WeakRef<Channel>>();
  // Not refused, and here to show the container is not the problem.
  #active = new Map<string, Channel>();
  #refs = new Map<string, number>();

  set(key: string, value: Channel): void {
    this.#map.set(key, new WeakRef(value));
  }

  get(key: string): Channel | undefined {
    return this.#map.get(key)?.deref();
  }

  retain(key: string, value: Channel): void {
    this.#active.set(key, value);
    this.#refs.set(key, (this.#refs.get(key) ?? 0) + 1);
  }
}

const registry = new Registry();

export function channel(name: string): Channel {
  const existing = registry.get(name);
  if (existing !== undefined) return existing;
  const made = new Channel(name);
  registry.set(name, made);
  registry.retain(name, made);
  return made;
}
