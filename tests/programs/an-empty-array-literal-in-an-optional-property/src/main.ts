// `{ scores: [] }` where `scores?: number[]`: an optional property is held
// erased, and an empty literal, `never[]`, takes the type its slot expects --
// which was `Erased`, so it was refused as "an array literal that is not an
// array". The property's declared type says what the array holds. `filled`
// is the control, a non-empty literal in the same slot, and `required` the
// same empty literal where the property is not optional.

interface Holder {
  id: number;
  scores?: number[];
}

interface Required {
  id: number;
  scores: number[];
}

function build(seed: number): Holder {
  if ((seed & 1) === 0) return { id: seed, scores: [] };
  return { id: seed };
}

export function empty(seed: number): number {
  const h = build(seed | 0);
  if (h.scores === undefined) return -1;
  h.scores.push(seed);
  return h.scores.length * 100 + h.id;
}

export function filled(seed: number): number {
  const h: Holder = { id: seed | 0, scores: [seed, 0.5] };
  return h.scores === undefined ? -1 : h.scores.length + h.id;
}

export function required(seed: number): number {
  const r: Required = { id: seed | 0, scores: [] };
  r.scores.push(1);
  return r.scores.length + r.id;
}

console.log(empty(2), empty(3), filled(1), required(4));
