// A closure a module-scope `const` holds, called in a loop.
//
// Four bindings in `runtime/node` have this shape, counted rather than assumed.
// It is a different question from `closures`, which makes its closure inside the
// function that calls it. There the receiver's static type is the closure's own
// class, so the call is direct by construction. Here the receiver is a *global*,
// and a global is storage: the pointer has to be loaded before it can be called,
// and whether the load is hoisted out of the loop and the call devirtualized is
// the whole measurement.
//
// The mixing is `closures`'s, deliberately, so the two rows are comparable and
// the difference between them is the binding rather than the arithmetic. A
// linear accumulation has a closed form clang finds, which would measure the
// optimizer instead of the code.

let step = 0;

const mix = (x: number): number => (((x * 2654435761) ^ (x >>> 3)) + step) | 0;

// One module-scope arrow calling another, which is the shape a small helper
// pulled out of a hot path actually has.
//
// The `& 0xfff` is load-bearing and was not there first. `x * 2654435761` is a
// *float64* multiply in JavaScript, and for a full-range int32 the product
// exceeds 2^53, so it is inexact and `| 0` of it is not the wrap C computes:
// -1234567890 gives 13945344 here against 13945550 there. `mix` is safe when it
// is called with a loop counter, which is why `closures` never met this; feeding
// its own int32 result back in is what crosses the line. Masking to the same
// domain the loops use keeps both lanes computing one function.
//
// Found by the benchmark's cross-variant checksum, which exists to stop a
// variant being fast because it computed something else, and caught a variant
// that was simply wrong.
const twice = (x: number): number => mix(mix(x) & 0xfff) | 0;

function drive(f: (x: number) => number, times: number): number {
  let total = 0;
  for (let i = 0; i < times; i++) {
    total = (total ^ f(i)) | 0;
  }
  return total;
}

export function work(seed: number): number {
  step = seed | 0;

  // Called through the global, in the loop.
  let total = 0;
  for (let i = 0; i < 4096; i++) {
    total = (total ^ mix(i)) | 0;
  }

  // One global reading another.
  for (let i = 0; i < 4096; i++) {
    total = (total ^ twice(i)) | 0;
  }

  // Handed to something that knows only that it is callable.
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
