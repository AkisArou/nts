// **The arm whose absence cost 112 recorded test262 cases.**
//
// Its own program rather than an arm beside `a-generator-function-expression`: the
// wrapper's `#call` returns a `Generator` and a generator closure's returns its own
// frame class, and every closure's `#call` overrides one dispatch slot, so the two
// together are refused by the JVM (`NTS4009`) and correctly.

/**
 * **The arm whose absence cost 112 recorded test262 cases**, and the reason this
 * fixture is worth reading before the next change to `lower_closure`.
 *
 * A class's *private* generator method, handed out **as a value** -- which is how
 * every `{expressions,statements}/class/dstr/private-gen-meth-*` test is written:
 *
 *     var C = class {
 *       * #method([[x, y, z] = [4, 5, 6]]) { ... }
 *       get method() { return this.#method; }
 *       };
 *     new C().method([]).next();
 *
 * The method lowers as a method and always did. What reaches `lower_closure` is the
 * **bound-method wrapper** `collect_closures` builds for `this.#method` as a value,
 * and a wrapper forwards rather than generating. Reserving a frame for it made it
 * compile down the closure path where it had refused, and the field index and the
 * pointer type then disagreed: 56 files refused at a field index outside their
 * layout and 56 more emitted C that does not compile.
 *
 * This arm was *not* in the first version of this fixture, nor in any of the four
 * other arms that change was measured with -- and each of those was green. Which is
 * why the recorded test262 set is the population for a lowering change that widens
 * what compiles, and `runtime/` is the narrow corpus: neither contains a method
 * handed out as a value.
 */
class Held {
  *#counted(): Generator<number> {
    yield 5;
    yield 6;
  }

  get handed(): () => Generator<number> {
    return this.#counted;
  }
}

export function viaAPrivateMethodHandedOut(n: number): number {
  const held = new Held();
  const generate = held.handed;
  let total = 0;
  for (const value of generate()) {
    total += value;
  }
  return total + n;
}

/**
 * The control beside it: the same private generator **called directly**, which never
 * reaches a wrapper. If this one ever starts refusing, the guard has gone too far
 * and is refusing the generator rather than the forwarder.
 */
class Direct {
  *#counted(): Generator<number> {
    yield 7;
    yield 8;
  }

  sum(): number {
    let total = 0;
    for (const value of this.#counted()) {
      total += value;
    }
    return total;
  }
}

export function viaAPrivateMethodCalledDirectly(n: number): number {
  return new Direct().sum() + n;
}
