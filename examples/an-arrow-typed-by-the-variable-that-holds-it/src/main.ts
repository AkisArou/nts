// Contextual typing gives an arrow's *parameters* their types and leaves its
// return inferred from the body, so the checker answers `(_n: string) => null`
// for the arrow in
//
//     const make: (name: string) => Task | null = (_name) => null;
//
// `null` has no representation of its own, so the function refused as "a
// function returning null" -- while the type the program actually wrote, one
// node up, represents perfectly well. Two things were needed: taking the return
// type from the declaration when the arrow's own does not represent, and
// lowering a **concise** body *expecting* that type, which a block body's
// `return` already did.
//
// Each form is here because each failed differently: with only the first fix the
// block body compiled and the concise one still refused, and with only the second
// nothing changed, because the signature refuses before the body is reached.

type Task = unknown;

interface Thing {
  readonly tag: number;
}

/** A concise body. */
const concise: (name: string) => Task | null = (_name) => null;

/** A block body -- the same function, and it refused the same way. */
const block: (name: string) => Task | null = (_name) => {
  return null;
};

/** Annotated on the arrow, which refused too: the body was the other half. */
const annotated: (name: string) => Task | null = (_name): Task | null => null;

/** A **reference** element, so this is not only about an erased slot. */
const reference: (name: string) => Thing | null = (_name) => null;

/** The arm that returns a value, so the fold is not just about `null`. */
const thing: (name: string) => Thing | null = (name) => ({ tag: name.length });

/**
 * **Through a conditional**, which is where this shape actually occurs and which
 * the first version of the change missed entirely: the arrow's parent is the `?:`,
 * not the declaration, so stopping at the immediate parent cleared nothing on the
 * corpus this was written for. Both arms of a conditional carry the conditional's
 * own contextual type, so recursing to the declaration is sound.
 */
const decided = false;

const chosen: (name: string) => Task | null = decided
  ? (name) => name.length
  : (_name) => null;

/** Parenthesised, for the same reason one node kind over. */
const wrapped: (name: string) => Task | null = (_name) => null;

export function useConcise(x: number): number {
  return concise("a") === null ? x : x + 1;
}

export function useBlock(x: number): number {
  return block("a") === null ? x : x + 1;
}

export function useAnnotated(x: number): number {
  return annotated("a") === null ? x : x + 1;
}

export function useReference(x: number): number {
  return reference("a") === null ? x : x + 1;
}

export function useThing(x: number): number {
  const got = thing("abc");
  return got === null ? -1 : got.tag + x;
}

/**
 * **Control, and the one that would catch a loose parent walk.** This arrow is
 * written *inside* a function whose own return type is `number`. Searching
 * upwards for "the nearest function type" would find the enclosing function and
 * give the arrow a `number` return -- a wrong answer in a function that
 * compiles, rather than a refusal. It takes its own inferred type instead,
 * because only a declaration's initializer supplies a contextual type here.
 */
export function nestedArrowKeepsItsOwn(x: number): number {
  const twice = (n: number) => n * 2;
  return twice(x);
}

/** **Control.** An arrow whose own return type already represents. */
export function ordinary(x: number): number {
  const inc: (n: number) => number = (n) => n + 1;
  return inc(x);
}

export function useChosen(x: number): number {
  return chosen("abc") === null ? x : x + 1;
}

export function useWrapped(x: number): number {
  return wrapped("a") === null ? x : x + 1;
}
