// Two real caller types exercise the shared erased symbol read.
// Each subject/control pair differs only in the erased or concrete receiver.
const key: unique symbol = Symbol("key");
interface Keyed { [key]: number; }

class SymbolFirst {
  [key]: number;
  padding: number;
  constructor(n: number) {
    this[key] = n;
    this.padding = n + 1000;
  }
}

class PaddingFirst {
  padding: number;
  [key]: number;
  constructor(n: number) {
    this.padding = n + 2000;
    this[key] = n;
  }
}

function castKeyed(value: unknown): number {
  return (value as Keyed)[key];
}

export function subjectSymbolFirst(n: number): number {
  return castKeyed(new SymbolFirst(n));
}
export function controlSymbolFirst(n: number): number {
  return new SymbolFirst(n)[key];
}
export function subjectPaddingFirst(n: number): number {
  return castKeyed(new PaddingFirst(n));
}
export function controlPaddingFirst(n: number): number {
  return new PaddingFirst(n)[key];
}
