// An abstract class's optional methods, which a subclass may leave out.
// Lowering keeps such a method as a declaration with no body, so the class
// that does not define it still has the slot: its entry refuses by name if a
// call ever reached it, and none does, since `?.()` tests the receiver's class
// before calling. So `Bare` allocates and its absent method is skipped, as in
// node.
abstract class Corkable {
  seen = 0;
  uncork?(): void;
  note?(by: number): void;
}

class Full extends Corkable {
  uncork(): void {
    this.seen += 1;
  }
  note(by: number): void {
    this.seen += by;
  }
}

class Bare extends Corkable {
  override seen = 100;
}

export function calledOrSkipped(n: number): number {
  const c: Corkable = (n & 1) === 0 ? new Full() : new Bare();
  c.uncork?.();
  return c.seen;
}

export function withAnArgument(n: number): number {
  const c: Corkable = (n & 2) === 0 ? new Full() : new Bare();
  c.note?.(n);
  c.note?.(1);
  return c.seen;
}
