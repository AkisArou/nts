// Converting text that is already in the asked case allocates nothing: the
// runtime answers the input retained (the MakesOrRetains contract), where
// `case-convert` beside this pays one string per conversion because its text
// changes.
//
// The store is what makes the retain load-bearing, as there. `box.text`
// holds the answer while `source` -- a heap string, not an immortal literal
// -- is read again on the next iteration and after the loop. Each store
// gives back the slot's previous reference, which is the source itself under
// the retained answer: take the retain out of the runtime and the second
// store frees the source under its reader. That is this case's control
// experiment, and it is why the source is built by a concatenation.

class Box {
  text: string;
  constructor() {
    this.text = "";
  }
}

export function work(n: number): number {
  const source = "already lower text " + n;
  const box = new Box();
  let total = 0;
  for (let i = 0; i < 16 + n; i = i + 1) {
    box.text = source.toLowerCase();
    total = total + box.text.length;
  }
  return total + source.length;
}
