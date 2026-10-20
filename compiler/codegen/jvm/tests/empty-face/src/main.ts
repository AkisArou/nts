// test262's `class C { method([]) {} }` called with a generator, typed: the
// parameters' `Iterable<number>` and `Iterable<string>` share one empty
// layout with `C` itself, and the JVM backend declined the stores as a
// generator not extending `C`. Each face specialization is referred to as
// the JVM root on its own facts, so each store is an upcast, while `C`
// keeps its class: `instanceof` still names it. `Named` is the control: a
// face with a field keeps its own class.
const numbers = (function* (): Generator<number> {
  yield 1;
})();

const strings = (function* (): Generator<string> {
  yield "a";
})();

class C {
  method(it: Iterable<number>): number {
    return 1;
  }

  other(it: Iterable<string>): number {
    return 2;
  }
}

interface Named {
  name: string;
}

function read(named: Named): string {
  return named.name;
}

export function answer(): number {
  const c: unknown = new C();
  if (!(c instanceof C)) return 0;
  return c.method(numbers) + c.other(strings) + read({ name: "x" }).length;
}
