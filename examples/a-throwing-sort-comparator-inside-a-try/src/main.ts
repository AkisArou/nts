// A `sort` comparator that throws, with the handler outside the sort.
//
// **`sort` is the one array method that *calls* its callback.** `map`'s and
// `filter`'s are lowered into the loop, so a `throw` in one is this function's own
// and reaches the handler by a branch; `lower_sort_with` builds a merge sort and
// calls the comparator from inside it, so a `throw` there crosses a call like any
// other. `call_within` has refused a `try` over one since 6 of 29 cases declined
// without the rule.
//
// It compiles now, and what makes it compile is that the comparator call goes
// through the **uniform raising entry** -- the same slot a call through a function
// value uses -- rather than through a written one. There is no slot for a written
// entry's raising copy and there should not be: the JVM lane's answer to that
// question is that a written entry's descriptor is per signature, so it cannot live
// on the root every callable shares, and a call through it would need a checkcast to
// the signature class -- which a closure need not extend, because one closure is
// stored at several signatures. That is the 81 closure-store declines their root was
// built to remove, returning for every comparator.
//
// So the comparator's two arguments are marshalled through `NtsValue` at a raising
// site, which is the erase/unerase pair A6 measured as free, and only inside a `try`.
//
// # Why this is its own file
//
// `lower_sort_with` built the comparator's call by hand instead of going through
// `finish_closure_call`, and that is how it drifted: it passed the comparator's
// *written* arguments whatever callee `closure_callee` had chosen. For an unguarded
// sort with a known comparator that choice is a `Callee::Direct` naming the written
// `Closure{n}#call`, where written arguments are exactly right; for a guarded one it
// is the uniform slot, where they are not. So **C called through an entry of the
// wrong ABI and the sort did not order** -- 5 where node answers 1 -- while the arm
// beside it was correct, and the JVM refused the copy outright. One path now
// (`call_a_closure_entry`), so a site cannot choose a callee and then ignore what
// that callee takes.
//
// **Not `fields::devirtualize`**, which is where I first put the difference and was
// wrong: the direct call is `closure_callee`'s own, made during lowering where "the
// receiver's static type *is* the closure class" holds. The JVM lane read the
// prepared HIR and found every guarded sort still `call.closure[2]`, with no rewrite
// anywhere -- so nothing later resolves these sites, and the hazard of a rewrite
// undoing the erasures but not the read-back cannot arise today.
//
// `tooling/conformance/outcomes/a-method-raising-copy-calling-a-function-value-it-
// does-not-devirtualize` is the JVM lane's record of that wrong answer.

function fussy(a: number, b: number): number {
  if (a > 6 || b > 6) {
    throw new RangeError("too big to compare");
  }
  return a - b;
}

function plain(a: number, b: number): number {
  return a - b;
}

/**
 * The `try` directly around the sort, and the comparator throws for an element
 * above 6 -- so the low arms sort and the high ones are caught.
 */
export function directlyAroundTheSort(n: number): number {
  const items = [3, 1, 2, n & 15];
  try {
    return items.sort(fussy)[0]!;
  } catch {
    return -1;
  }
}

/**
 * **The control, and it is the arm that says what the variable is**: the same sort,
 * the same `try`, a comparator that cannot throw. It must keep ordering, and it is
 * what catches a repair that makes every sort refuse or every sort wrong.
 */
export function withAQuietComparator(n: number): number {
  const items = [3, 1, 2, n & 15];
  try {
    return items.sort(plain)[0]!;
  } catch {
    return -1;
  }
}

class Jar {
  items: number[] = [3, 1, 2];
  smallest(): number {
    return this.items.slice().sort(fussy)[0]!;
  }
}

/**
 * **The other control: no `try` at all**, so `closure_callee` names the written
 * `Closure{n}#call` directly -- the receiver's static type *is* the closure class and
 * the call is not a raising one, which is the condition that function states. It is the one-difference pair for the arms above -- the
 * same sort, the same comparator, the handler removed -- and it is what catches a
 * repair that makes an ordinary sort pay for a guarded one.
 *
 * It is also the only site in this file reached by a *name* at all: the JVM lane
 * checked the prepared HIR and **every guarded sort stays `call.closure[2]`**,
 * erasing both arguments and unerasing the result once. If `devirtualize` is ever
 * taught the raising slot, this arm and `directlyAroundTheSort` are the pair that
 * would show whether `hir::call_directly` undoes the read-back as well as the
 * erasures.
 *
 * `n & 3` rather than `n & 15`, deliberately: an uncaught `throw` **ends the
 * program**, so the cases after it in the pool are never reached and the example
 * compares fewer of them -- 108 of 116 rather than all of them, with the loss
 * depending on the order the pool happens to take. What this arm is for is the
 * devirtualized dispatch, which an input that never throws exercises just as well.
 */
export function outsideATry(n: number): number {
  const items = [3, 1, 2, n & 3];
  return items.sort(fussy)[0]!;
}

/**
 * One frame down: the `try` is around a method, and the sort is inside the method's
 * *raising copy*. This is the shape the JVM lane found, and the one the ordinary
 * body's devirtualization used to hide.
 */
export function throughAMethod(n: number): number {
  const jar = new Jar();
  jar.items.push(n & 15);
  try {
    return jar.smallest();
  } catch {
    return -1;
  }
}
