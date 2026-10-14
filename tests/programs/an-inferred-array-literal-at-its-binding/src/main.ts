// A fresh array literal of records, bound without an annotation inside a
// function. The binding's type is the literal's widened, and the checker
// gives the two -- and each nested record -- distinct ids, so the array was
// built at one and coerced to the other: "an array of Object(124) where an
// array of Object(126) is wanted", refused. It is built at the binding's type
// now (re-derived from Codex 7dab54f0a).
//
// Control, one difference: `annotated` writes the type, which always built at
// the slot.
//
// **`passed` is still refused, and registered** (tooling/gate/example-refusals):
// handing the array to an `Entry[]` parameter compares the element records,
// whose `nested` fields name two ids for one shape -- and `one_slot` looks a
// nested layout up rather than creating it mid-lowering (record 0199), and
// finds none yet. When that compiles, the count here drops.

type Entry = { value: number; nested: { text: string } };

export function readBack(n: number): number {
  const backing = [{ value: n, nested: { text: "abc" } }];
  return backing[0]!.value + backing[0]!.nested.text.length;
}

export function written(n: number): number {
  const backing = [{ value: n, nested: { text: "a" } }];
  backing[0]!.value = n + 2;
  backing[0]!.nested.text = "abcd";
  return backing[0]!.value * 10 + backing[0]!.nested.text.length;
}

export function grown(n: number): number {
  const backing = [{ value: n, nested: { text: "a" } }];
  backing.push({ value: n * 3, nested: { text: "xyz" } });
  let total = 0;
  for (const entry of backing) total += entry.value + entry.nested.text.length;
  return total;
}

function sum(entries: Entry[]): number {
  let total = 0;
  for (const entry of entries) total += entry.value;
  return total;
}

export function passed(n: number): number {
  const backing = [
    { value: n, nested: { text: "a" } },
    { value: n + 1, nested: { text: "b" } },
  ];
  return sum(backing);
}

export function annotated(n: number): number {
  const backing: Entry[] = [{ value: n, nested: { text: "ab" } }];
  return backing[0]!.value + backing[0]!.nested.text.length;
}
