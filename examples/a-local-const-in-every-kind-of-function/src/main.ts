// A `const` declared inside an arrow, a function expression or an accessor.
//
// `collect_module_scope` walks every `VARIABLE_DECLARATION` in the program and
// skips the ones inside a function. It asked `is_within_a_function`, which knew
// `FUNCTION_DECLARATION`, `METHOD_DECLARATION` and `CONSTRUCTOR` — and not
// `ARROW_FUNCTION`, `FUNCTION_EXPRESSION`, `GET_ACCESSOR` or `SET_ACCESSOR`.
//
// So a local in one of those four became a **module-scope global**, and its
// initializer was deferred to `module#init`, where the enclosing function's
// parameters and receiver do not exist. Both diagnostics that came out of it
// describe `module#init` accurately and describe the source falsely:
//
//     const f = (k: number) => { const c = k + 1; return c; };
//     `k`, a name from an enclosing scope
//
//     count = (label: string) => { const c = this.#counts.get(label) ?? 0; };
//     `this` outside a method
//
// `k` is the arrow's own parameter. `this` is the instance. Neither sentence is
// about anything the program wrote.
//
// # Why it was two items and not one
//
// 192 refusals across eleven corpus modules said the first and about 170 said
// the second, and every census this project has run groups by message text —
// so this function appeared as two unrelated entries in two different parts of
// the ranking, and neither entry named it. The `this` half was found first and
// fixed at a different site (`examples/this-in-a-field-initializer`), which
// cleared some of them and left the rest saying exactly the same words. That
// remainder is what pointed here: a fix that clears *part* of a message's count
// says the message had more than one cause.
//
// # The message is now trustworthy, which it was not before
//
// "a name from an enclosing scope" is a real refusal for a real construct: a
// nested `function` declaration closing over an enclosing local, which this
// compiler does not lower. `runtime/node/path/src/glob-matcher.ts:596` is one —
// `function visit()` inside `patternMatches`, capturing `columns`.
//
// Those stayed. What went is the ones that were never about scope at all, and
// what that buys is a message a reader can act on: before, following it meant
// looking for a capture that was not there.
//
// # Controls
//
// `inAFunctionDeclaration` is the same local in the one function kind that was
// already listed, which is what says this is the *list* and not the concept.
// `atModuleScope` is a genuine module-scope `const` that must still be folded
// as one — the check being widened, this is the half that must not move.

/** Under test: an arrow-local `const` reading the arrow's own parameter. */
export const addOne = (k: number): number => {
  const c = k + 1;
  return c;
};

/** Under test: the same inside a function expression. */
export const addTwo = function (k: number): number {
  const c = k + 2;
  return c;
};

class Counting {
  #counts = new Map<string, number>();
  /** Under test: an arrow field whose local `const` reads `this`. */
  count = (label: string = "default"): number => {
    const c = (this.#counts.get(label) ?? 0) + 1;
    this.#counts.set(label, c);
    return c;
  };
  /** Under test: an accessor whose local `const` reads `this`. */
  get size(): number {
    const held = this.#counts.size;
    return held * 10;
  }
  /** Under test: a setter, which is the fourth kind. */
  set seed(n: number) {
    const label = "seeded";
    this.#counts.set(label, n);
  }
}

/** Control: the one function kind that was already on the list. */
export function inAFunctionDeclaration(k: number): number {
  const c = k + 3;
  return c;
}

/** A genuine module-scope `const`, which must still be one. */
const SCALE = 7;

/** Control: the half that must not move when the check is widened. */
export function atModuleScope(n: number): number {
  return SCALE * 2 + n * 0;
}

export function throughAnArrow(n: number): number {
  return addOne(n);
}

export function throughAnAccessor(n: number): number {
  const o = new Counting();
  o.count("x");
  o.count("x");
  o.seed = n;
  return o.size + o.count("x");
}
