export function lateFactory(n: number): number {
  return makeLater(n)(n + 1);
}

function makeLater(n: number): (value: number) => number {
  return (value) => value + n;
}

export function suppliedCallback(callback: (n: number) => number, n: number): number {
  return callback(n);
}

export function escapingCallback(n: number): (value: number) => number {
  return (value) => value + n;
}

export function raisingCallback(n: number): () => number {
  return () => {
    if (n < 0) throw n;
    return n;
  };
}

// The inner frame is allocated only by a runtime reaction, not an ordinary
// direct caller of this exported function.
export function runtimeFactory(n: number): Promise<number> {
  return Promise.resolve(n).then((outer) =>
    Promise.resolve(outer + 1).then((inner) => outer + inner));
}
