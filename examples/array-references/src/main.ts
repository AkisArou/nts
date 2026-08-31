// Array methods where the element is a *reference*.
//
// Its own example rather than part of `arrays`, and for a reason worth writing
// down: `arrays_can_grow` is asked of a whole program, so a single `push`
// anywhere in a module makes every array's length unprovable in it. Adding
// these functions to `arrays` took its remaining bounds checks from four to
// nine, and that fixture exists to pin how few there are. The coarseness is
// deliberate -- the precise version is a may-grow fixpoint over parameters and
// fields -- but a measurement of it should not be destroyed by a test of
// something else.
//
// Three things change with the element and nothing else does. `pop` and `at`
// answer `T | undefined`, which for a reference is the null pointer, so they
// return the element type and need no tag. `indexOf` compares by `===`, and
// `===` on a string is value equality -- `["a"].indexOf("a")` is 0 across two
// separately built strings, which a pointer comparison would miss. And every
// element that moves into or out of an array is a reference count: `push`
// retains what it is given, `at` retains what it hands back, `slice` retains
// each element it copies, and `pop` retains nothing because the array is giving
// up its own count along with the element.
//
// Under `NTS_PROVIDER_RC` this file has to return to its baseline, which is
// what makes those four sentences a test rather than a claim -- and is what
// caught `fill` and `reverse` handing back their receiver without retaining it.

function words(n: number): string[] {
  return ["a" + String(n), "b", "c"];
}

export function pushedLength(n: number): number {
  const xs = words(n);
  return xs.push("d" + String(n)) + xs.length;
}

export function foundByValue(n: number): number {
  const xs = words(n);
  // Built separately from the element it must equal.
  const needle = "a" + String(n);
  return xs.indexOf(needle) * 10 + (xs.includes(needle) ? 1 : 0) + xs.indexOf("zz");
}

export function poppedText(n: number): string {
  const xs = words(n);
  const last = xs.pop();
  const rest = xs.pop();
  return String(last) + String(rest) + String(xs.length);
}

export function elementAt(n: number): string {
  const xs = words(n);
  return String(xs.at(0)) + String(xs.at(-1)) + String(xs.at(99));
}

export function slicedText(n: number): string {
  const xs = words(n);
  const tail = xs.slice(1);
  return String(tail.length) + tail[0] + tail[1] + String(xs.reverse()[0]);
}

// A reference element that is not a string, where `===` is identity: two
// objects of equal contents are two objects, and neither finds the other.
class Marked {
  v: number;
  constructor(v: number) {
    this.v = v;
  }
}

export function foundByIdentity(n: number): number {
  const held: Marked[] = [new Marked(n)];
  const same = held[0]!;
  const other = new Marked(n);
  held.push(other);
  return (
    held.indexOf(same) * 100 +
    held.indexOf(other) * 10 +
    (held.includes(new Marked(n)) ? 1 : 0) +
    held.length
  );
}

// `push` takes as many elements as it is given -- `headers.push(name, value)`
// is how a flat key-value list is built, and appending two is appending one
// twice. The expression is worth the length after the last.
export function pushedPair(n: number): string {
  const xs: string[] = [];
  const after = xs.push("k" + String(n), "v");
  return String(after) + String(xs.length) + xs[0] + xs[1];
}

// `join`, which is one allocation of a known length rather than a fold of
// concatenations: the first pass adds up the code units and asks whether any
// needs two bytes, the second writes. A separator defaults to a comma, and an
// empty array joins to an empty string whatever the separator is.
export function joinedText(n: number): string {
  const xs = words(n);
  const none: string[] = [];
  const wide: string[] = ["é" + String(n), "中"];
  return (
    xs.join(", ") +
    "|" +
    xs.join("") +
    "|" +
    xs.join() +
    "|[" +
    none.join("-") +
    "]|" +
    wide.join("—") +
    String(wide.join("—").length)
  );
}
