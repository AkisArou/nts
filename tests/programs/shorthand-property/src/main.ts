// `{ x }` is `{ x: x }`, and for a long time only one of them lowered.
//
// The checker gives a shorthand property one node serving as both the field
// name and a reference to a variable, and its symbol is the **property's**.
// `getShorthandAssignmentValueSymbol` answers the other one and the snapshot
// does not carry it, so the reference has to be resolved by name. That much was
// always true and is written down where it happens.
//
// What was wrong was the *scope* of that fallback. It looked in the local
// bindings and nowhere else, and it took what it found raw:
//
//   - a narrowed local was found and handed over **unnarrowed**, so
//     `{ first }` refused where `{ first: first }` compiled -- on the same
//     value, in the same function, one line apart;
//   - a module-scope function was not found at all, so `{ lowers }` read as
//     "a shorthand naming nothing in scope" for a name declared in the file.
//
// Both now go through the one chain every other reference uses, which is what
// makes the narrowing and the module scope come for free rather than twice.
//
// The explicit spelling is beside each subject on purpose. If a control ever
// refuses, this file has stopped being about shorthand.

function items(): number[] {
  return [3, 5, 7];
}

// --- a narrowed local -------------------------------------------------------

// Control: narrowed and used, no object anywhere.
export function narrowedBare(n: number): number {
  const first = items()[0];
  if (first === undefined) {
    return -1;
  }
  return first + n;
}

// Control: narrowed into an object, spelled out.
export function narrowedExplicit(n: number): number {
  const first = items()[0];
  if (first === undefined) {
    return -1;
  }
  const held = { first: first };
  return held.first + n;
}

// Subject.
export function narrowedShorthand(n: number): number {
  const first = items()[0];
  if (first === undefined) {
    return -1;
  }
  const held = { first };
  return held.first + n;
}

// Two of them, so the lookup is not right by having one candidate.
export function twoNarrowed(n: number): number {
  const xs = items();
  const first = xs[0];
  const second = xs[1];
  if (first === undefined || second === undefined) {
    return -1;
  }
  const pair = { first, second };
  return pair.first * 100 + pair.second + n;
}

// --- a local shadowing a module-scope name ----------------------------------
//
// The lookup asks the locals first, because a local shadows. Getting that order
// wrong is a wrong answer that compiles: the object would hold the module's
// binding where the source names the local.

const doubled = 1000;

export function localShadows(n: number): number {
  const doubled = n + 1;
  const held = { doubled };
  return held.doubled;
}

export function moduleScopeWhenNotShadowed(n: number): number {
  const held = { doubled };
  return held.doubled + n;
}
