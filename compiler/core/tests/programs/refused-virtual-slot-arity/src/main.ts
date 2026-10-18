class Root {
  invoke(n: number): number { return this.read(n); }
  read(n: number): number { return n + 1; }
}
class Narrow extends Root {
  override read(): number { return 7; }
}
class RefusedNarrow extends Narrow {
  override read(): number { return eval("9"); }
}
class LiveNarrow extends Narrow {
  override read(): number { return 9; }
}

// One stopped input; the other 28 must keep dispatching to the live body.
export function oneRefused(n: number): number {
  const receiver: Root = n === 1 ? new RefusedNarrow() : new LiveNarrow();
  return receiver.invoke(n);
}
export function control(n: number): number {
  const receiver: Root = n === 1 ? new Narrow() : new LiveNarrow();
  return receiver.invoke(n);
}
