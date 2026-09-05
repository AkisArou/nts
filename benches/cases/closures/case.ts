// A closure created once and called in a loop, twice over: where it is made,
// and across a function boundary where only its signature type is visible.
//
// The question is whether the abstraction is free. A closure here is an object
// with one method, so the first loop is a call on a receiver whose static type
// is the closure's own class -- final, so the body is known and the call is
// direct. The second hands it to something that knows only that it is callable,
// which is the case a compiler has to work for: `hir::monomorphize` clones
// `drive` for the closure it receives, which is what a C++ programmer gets by
// writing a template.
//
// The mixing is deliberate. A linear accumulation has a closed form and clang
// finds it, which measures the optimizer rather than the code; a multiply and a
// shift and an xor do not.

function drive(f: (x: number) => number, times: number): number {
  let total = 0;
  for (let i = 0; i < times; i++) {
    total = (total ^ f(i)) | 0;
  }
  return total;
}

export function work(seed: number): number {
  const step = seed | 0;
  const mix = (x: number): number => (((x * 2654435761) ^ (x >>> 3)) + step) | 0;

  // Made and called here.
  let total = 0;
  for (let i = 0; i < 4096; i++) {
    total = (total ^ mix(i)) | 0;
  }

  // Handed to something else, which knows only that it is callable.
  total = (total + drive(mix, 4096)) | 0;
  return total;
}

/**
 * The input the harness calls `work` with.
 *
 * Declared here because this is the only file that knows it. Every driver --
 * native, JVM and node -- is generated from this and the exported function
 * above, so the workload is stated once instead of once per lane. It is
 * `volatile` in each of them: a loop-invariant argument lets the optimiser
 * hoist the whole call out of the timed region and report an impressive zero.
 */
export const seed = 5;
