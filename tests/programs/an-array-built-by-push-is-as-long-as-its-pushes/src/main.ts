// An array built by `push` is at least as long as the pushes it has certainly
// had, and a read below that needs no bounds check.
//
// `bounds` removes a check when the index is below the array's smallest length.
// Where a program can push anywhere, an allocation's length is not exact, so an
// array built empty and pushed in a loop -- the commonest array there is -- had
// no length to compare with, and every read kept its check. A checked read is
// an exit from its loop, and LLVM forwards a store in one trip to the next
// trip's load only in a loop with one exit: `benchmarks/cases/growth-grown`,
// which is `smooth`, ran at 4.0x its C++ where the same loop over an array that
// cannot grow runs at 1.04x.
//
// The length only grows when every use of the array is a read, a store into it,
// its length or a push, and nothing carries it into a block parameter. Then a
// loop whose exit only its header's test reaches has run at least
// (bound - start) / step trips by then, and a push on every trip pushed that
// many. `smooth` counts up and `countdown` counts down.
//
// The controls are the three ways that would be wrong, each one change from
// `smooth`'s fill. In `truncated` a `break` reaches the exit with fewer trips;
// in `popped` a `pop` shortens it; in `aliased` the `pop` arrives through a
// value that is sometimes the array. Each reads only as far as the array really
// reaches, by a bound the analysis cannot relate to it, so every case compares
// -- a read past the end would stop the program, which `nts check` counts as
// declined -- and their IR facts are the guard: the checks stay.
//
// expect-ir: all: no array.get.checked in smooth
// expect-ir: all: no array.set.checked in smooth
// expect-ir: all: no array.get.checked in countdown
// expect-ir: all: count array.get.checked in truncated >= 1
// expect-ir: all: count array.get.checked in popped >= 1
// expect-ir: all: count array.get.checked in aliased >= 1

export function smooth(seed: number): number {
  const xs: number[] = [];
  for (let i = 0; i < 64; i++) {
    xs.push(i * 3 + seed);
  }
  for (let round = 0; round < 4; round++) {
    for (let i = 1; i < 64; i++) {
      xs[i] = xs[i]! * 0.75 + xs[i - 1]! * 0.25;
    }
  }
  let total = 0;
  for (let i = 0; i < 64; i++) {
    total = total + xs[i]!;
  }
  return total;
}

export function countdown(seed: number): number {
  const xs: number[] = [];
  for (let i = 64; i > 0; i--) {
    xs.push(i + seed);
  }
  let total = 0;
  for (let i = 0; i < 64; i++) {
    total = total + xs[i]! * i;
  }
  return total;
}

export function truncated(seed: number, stop: number): number {
  const xs: number[] = [];
  for (let i = 0; i < 64; i++) {
    if (i === stop) {
      break;
    }
    xs.push(i * 3 + seed);
  }
  const reached = stop >= 0 && stop < 64 ? stop : 64;
  let total = 0;
  for (let i = 0; i < reached; i++) {
    total = total + xs[i]!;
  }
  return total;
}

export function popped(seed: number, keep: number): number {
  const xs: number[] = [];
  for (let i = 0; i < 64; i++) {
    xs.push(i * 3 + seed);
  }
  if (keep < 0) {
    xs.pop();
  }
  const reached = keep < 0 ? 63 : 64;
  let total = 0;
  for (let i = 0; i < reached; i++) {
    total = total + xs[i]!;
  }
  return total;
}

export function aliased(seed: number, pick: number): number {
  const xs: number[] = [];
  const ys: number[] = [1, 2];
  for (let i = 0; i < 64; i++) {
    xs.push(i * 3 + seed);
  }
  const zs = pick > 0 ? xs : ys;
  zs.pop();
  const reached = pick > 0 ? 63 : 64;
  let total = 0;
  for (let i = 0; i < reached; i++) {
    total = total + xs[i]!;
  }
  return total;
}
