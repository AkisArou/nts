// A module `const` is a borrow wherever it is read (`hir::own`): nothing can
// write it after the module initializer's one store, so a load of it handed
// to a call needs no count around it. The same call writes the module `let`
// before reading its argument, so its earlier value must survive that write.
// A pure search helper alone cannot witness that obligation.

const WORDS = "alpha beta gamma delta epsilon zeta eta theta";

let changing = "alpha beta gamma delta";
changing = changing + " epsilon zeta eta theta";

function inspect(value: string, position: number): number {
  if (position === 1) changing = changing + ".";
  return value.indexOf(" ", position);
}

export function readsConst(seed: number): number {
  let total = 0;
  for (let i = 0; i < WORDS.length; i++) {
    total = total + inspect(WORDS, i);
  }
  return total + (seed & 1);
}

export function readsLet(seed: number): number {
  let total = 0;
  for (let i = 0; i < changing.length; i++) {
    total = total + inspect(changing, i);
  }
  return total + (seed & 1);
}
