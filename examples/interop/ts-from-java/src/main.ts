// TypeScript published so that Java can call it.
//
// Unlike java-from-ts, this project COMPILES AND RUNS TODAY: `nts emit-jvm`
// already produces the class files, and `javac` already type-checks Java
// against them. So `expected/Api.javap` is a real artefact, not a specification.

export class Session {
  // `#hits` rather than `private hits`: `private` is a checker-only marker and
  // leaves an own enumerable key, where `#` is genuinely inaccessible.
  #hits: number = 0;

  // The accessor that makes item 0 work. A Java caller mutating through this
  // performs a `FieldSet` *in the HIR*, which is exactly what `hir::fields`
  // needs to keep its narrowing sound. The field itself is package-private and
  // Java cannot reach it.
  bump(): number {
    this.#hits = this.#hits + 1;
    return this.#hits;
  }

  hits(): number {
    return this.#hits;
  }
}

export function greet(name: string): string {
  return "hello " + name;
}

export function total(values: number[]): number {
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum = sum + values[i];
  }
  return sum;
}
