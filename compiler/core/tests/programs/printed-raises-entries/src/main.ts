// A generic method of a generic class: its instances are not copied per instance of
// the class, so its body is the one unavailable callee here.
class Picker<K> {
  key: K;
  constructor(key: K) {
    this.key = key;
  }
  pick<T>(value: T, fails: boolean): T { if (fails) throw 22; return value; }
}
class Unavailable {
  marker = 1;
  toString(): string { return new Picker(0).pick("unavailable", false); }
}
class Quiet {
  marker = "quiet";
  toString(): string { return this.marker; }
}

// Capturing a parameter in the initializer splits this into an entry and a
// binding body. Each half has a possible printer poll; both must read the
// final descriptor decision through their remapped ValueIds and Func names.
function initialized(value: unknown, read = () => value, prefix = String(value)): string {
  return prefix + ";" + String(value);
}

export function primitive(n: number): string { return initialized(n); }
export function quiet(): string { return initialized(new Quiet()); }
export function unavailable(): string { return String(new Unavailable()); }
export function control(): string { return String(new Quiet()); }
