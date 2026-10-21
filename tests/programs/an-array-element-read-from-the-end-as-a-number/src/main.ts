// `xs.at(i)!` read straight back as a number. `nts_array_at_value` answers an
// erased box, and every use of it unerases it to a float, so the JVM calls the
// scalar `arrayAt` instead and builds no box (`fuse::fused`, which asks core's
// `hir::erased_uses` what the uses are). `boxed` reads the same answer through
// `??`, which tests its tag, so it keeps the box: out of range the answer is
// `undefined`, and only the box can say so.
// `compiler/codegen/jvm/tests/fused_answers.rs` reads which each took.

export function fromTheEnd(seed: number): number {
  const xs = [1.5, 2.5, 3.5, (seed | 0) & 7];
  return xs.at(-1)! * 10 + xs.at(-2)!;
}

export function boxed(seed: number): number {
  const xs = [1.5, 2.5, 3.5, (seed | 0) & 7];
  return xs.at((seed | 0) % 6) ?? -1;
}
