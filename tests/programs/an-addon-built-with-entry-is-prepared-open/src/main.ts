// A product built with `--entry joiner,lastSeen,upTo` is entered from outside
// when it is an addon or a library, and only from module evaluation when it is
// an executable. `tooling/cli/tests/product_roots.rs` prepares this program in
// each shape.
//
// The host calls `joiner` and resumes what `upTo` returns, and nothing here
// does either. So an addon or a library keeps `Closure0#call` and
// `upTo__resume`, and the executable form (`--main --entry`, the control that
// differs in the shape alone) prunes both. Before the shape chose the roots,
// every named entry was closed: a JVM library's `joiner` was a class with no
// `call`, and a host got a generator it could not resume.
//
// Run as a program, it only says it loaded.
let last = "";

export const joiner = (a: string, b: string): void => {
  last = a + "|" + b;
};

export function lastSeen(): string {
  return last;
}

export function* upTo(limit: number): Generator<number> {
  for (let i = 0; i < limit; i++) yield i;
}

console.log("loaded", lastSeen().length);
