// A closure whose call returns another closure.
//
// Here rather than in `examples/` because the three backends do not agree
// about it yet: the lowering is right and C and LLVM compile it, while the JVM
// backend refuses the dispatch. An example is a claim on every lane at once,
// and this is a claim about the lowering.
//
// `subscribe` returning an unsubscribe is how most listener APIs are spelled,
// and `EventListenerSignal.subscribe(callback: () => void): () => void` in the
// shared Web source is exactly this.
interface Source {
  subscribe: (callback: (x: number) => number) => (() => number);
}

export function throughAReturnedFunction(n: number): number {
  const source: Source = {
    subscribe: (callback) => {
      const seen = callback(n);
      return () => seen + 1;
    },
  };
  return source.subscribe((x) => x * 2)();
}

// The returned closure captures nothing, so it is a different shape from the
// one above and only the first was ever exercised anywhere.
export function returnedWithoutCapture(n: number): number {
  const source: Source = {
    subscribe: () => (): number => 11,
  };
  return source.subscribe((x) => x)() + n;
}
