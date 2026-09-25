// expect: `poll`, captured above its own declaration, where it has no value yet
//
// A closure that passes itself to a later call -- the polling and retry idiom:
//
//     const poll = (): void => { if (!done()) { setTimeout(poll, 200); return; } ... };
//
// is refused, as capturing `poll` before the initialiser that gives it a value
// has finished. That is a fact about *capture*, and the refusal treats it as
// one about *reading*: the temporal dead zone forbids reading `poll` before it
// is initialised, and the closure reads nothing until it runs -- which is after
// `const poll = ...` has completed, because nothing calls it sooner. JavaScript
// runs it; so should nts.
//
// The control is its own fixture, `a-closure-called-inside-its-own-initialiser`:
// the same capture where the closure *is* called before the initialiser ends,
// `const g = now(() => g + 1)`, reads `g` in its dead zone and must stay
// refused.
// A fix that makes this one compile and that one too is too permissive.
//
// What the shape degrades to today: a method that reschedules itself,
// `setTimeout(() => this.poll(), 200)` -- the Windows lane's winui-hello waits
// for its window that way (2026-09-25).
//
// A queue drained later stands in for `setTimeout`, which this directory's
// configuration does not declare: the shape is the closure handing itself to
// something that calls it after `poll` has its value.
let tries = 0;
const later: Array<() => void> = [];

function defer(f: () => void): void {
  later.push(f);
}

export function start(): number {
  const poll = (): void => {
    tries += 1;
    if (tries < 3) {
      defer(poll);
    }
  };
  poll();
  while (later.length > 0) {
    const next = later.shift();
    if (next !== undefined) {
      next();
    }
  }
  return tries;
}
