// A borrow anchored at a `readonly` slot, held across a call that stores.
//
// `Field::readonly` means "never written after construction, semantic not
// syntactic, so `Readonly<T>` counts", and its own comment calls it
// load-bearing. Nothing reads it.
//
// This is what that costs. The config is on the heap -- a module-level slot
// holds it -- so a borrow out of it is a real one. `bump` stores, so it is in
// `mutating`, so every borrow crossing it dies, including one out of a slot the
// language guarantees `bump` cannot write. The checker knew; the allocator did
// not ask.

class Label {
  text: number;
  constructor(text: number) {
    this.text = text;
  }
}

class Config {
  readonly label: Label;
  spare: Label;
  constructor(label: Label) {
    this.label = label;
    this.spare = label;
  }
}

let kept: Config | null = null;

// Not harmless: it writes a reference over a live one, which is the only kind
// of store that can disconnect anything. A store of a number is already known
// to leave every borrow standing.
function bump(config: Config): void {
  config.spare = config.label;
}

export function work(n: number): number {
  const config = new Config(new Label(3));
  kept = config;
  let total = 0;
  for (let i = 0; i < 16 + n; i = i + 1) {
    const held = config.label;
    bump(config);
    total = total + held.text;
  }
  return total;
}
