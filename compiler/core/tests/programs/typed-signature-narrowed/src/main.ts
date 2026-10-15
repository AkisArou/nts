// A typed signature whose every call passes a whole number and whose every
// closure answers one: closure-merge's shape, with nothing else in the
// program. The signature is narrowed with its closures, so the calls take and
// return integers, and no double is left in the loop.
//
// Nothing else, deliberately: the analysis joins a call through the erased
// entry into every closure's erased entry, which hands `#call` a value it
// knows nothing about, so one generic call through any other signature keeps
// these parameters double (the result still narrows; the module states it).

export function merged(seed: number): number {
  let mix: (x: number) => number;
  if ((seed & 1) === 0) {
    mix = (x: number): number => (x * 3 + seed) | 0;
  } else {
    mix = (x: number): number => (x * 5 - seed) | 0;
  }
  let total = 0;
  for (let i = 0; i < 8; i++) total = (total ^ mix(i)) | 0;
  return total + drive(mix, 8);
}

function drive(f: (x: number) => number, times: number): number {
  let total = 0;
  for (let i = 0; i < times; i++) total = (total ^ f(i)) | 0;
  return total;
}
