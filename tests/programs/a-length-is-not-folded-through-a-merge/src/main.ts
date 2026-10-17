// An array's length is not known through a merge that can shorten it.
//
// `allocated_length_is_exact` folds `xs.length` to the length `xs` was
// allocated with when no use of `xs` can change it -- and it read only the
// uses of `xs` itself. A conditional that picks `xs` or another array is a
// block parameter, and a `pop` through it is a use of the parameter: in
// `aliasedLength` every use of `xs` kept the length, so `xs.length` folded to 3
// where node answers 2. `fields::lengths`, which records a field's array length
// for `bounds`, had the same blind spot: `fieldThroughMerge` shortens
// `h.items` through the parameter, and its recorded 6 let a check go that the
// shorter array needed. Both now count an array a block argument carries as
// handed on.
//
// `directLength` is the control: the same two pops, each on its own array, no
// merge.
//
// expect-ir: all: count array.get.checked in fieldThroughMerge >= 1

export function aliasedLength(pick: number): number {
  const xs: number[] = [1, 2, 3];
  const ys: number[] = [1, 2];
  const zs = pick > 0 ? xs : ys;
  zs.pop();
  return ys.length * 10 + xs.length;
}

export function directLength(pick: number): number {
  const xs: number[] = [1, 2, 3];
  const ys: number[] = [1, 2];
  if (pick > 0) {
    xs.pop();
  } else {
    ys.pop();
  }
  return ys.length * 10 + xs.length;
}

class Holder {
  items: number[] = [1, 2, 3, 4, 5, 6];
}

export function fieldThroughMerge(pick: number): number {
  const h = new Holder();
  const other: number[] = [9, 9];
  const a = pick > 0 ? h.items : other;
  a.pop();
  const last = pick > 0 ? 4 : 5;
  return h.items[last]! + h.items.length * 100;
}
