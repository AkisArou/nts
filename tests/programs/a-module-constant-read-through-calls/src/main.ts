// A module `const` is a borrow wherever it is read (`hir::own`): nothing can
// write it after the module initializer's one store, so a load of it handed
// to a runtime helper needs no count around the call. A helper is a call the
// ownership pass cannot see into, and a `let` it might write in between keeps
// its count: the one-difference control, written twice.

const WORDS = "alpha beta gamma delta epsilon zeta eta theta";

let changing = "alpha beta gamma delta";
changing = changing + " epsilon zeta eta theta";

export function readsConst(seed: number): number {
  let total = 0;
  for (let i = 0; i < WORDS.length; i++) {
    total = total + WORDS.indexOf(" ", i);
  }
  return total + (seed & 1);
}

export function readsLet(seed: number): number {
  let total = 0;
  for (let i = 0; i < changing.length; i++) {
    total = total + changing.indexOf(" ", i);
  }
  return total + (seed & 1);
}
