// A union narrowed by `in`, in a loop.
//
// This is what a discriminated union costs when the discriminant is *the shape
// itself* rather than a tag the program wrote. TypeScript lets you write it
// either way and the second is idiomatic; `runtime/node` has 224 sites of it.
//
// The compiler turns `"radius" in shape` into a test of the value's descriptor
// against the arms that declare `radius` -- one pointer comparison, the same
// operation `instanceof` is. The C++ reference writes the tag by hand, which is
// what a C++ programmer does and is the fair bar: it has no descriptor to
// consult, so the tag is storage the TypeScript does not spend.
//
// The mixing keeps the loop from having a closed form clang would find.

interface Circle {
  radius: number;
}

interface Square {
  side: number;
}

interface Wide {
  radius: number;
  side: number;
  both: number;
}

export function work(seed: number): number {
  const step = seed | 0;
  let total = 0;
  for (let i = 0; i < 4096; i++) {
    const which = i & 3;
    const shape: Circle | Square | Wide =
      which === 0
        ? { radius: (i ^ step) & 0xffff }
        : which === 1
          ? { side: (i + step) & 0xffff }
          : { radius: i & 0xff, side: step & 0xff, both: (i ^ step) & 0xff };
    // Two tests, and the second sees a narrower union than the first because
    // the first one failing rules an arm out.
    if ("both" in shape) {
      total = (total ^ (shape.both * 3)) | 0;
    } else if ("radius" in shape) {
      total = (total ^ (shape.radius * 5)) | 0;
    } else {
      total = (total ^ (shape.side * 7)) | 0;
    }
  }
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
