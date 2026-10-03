// Host measurements; these are not predictions of C/JVM performance.
// node tooling/conformance/ecmascript/bench.ts [iterations]
import { performance } from "node:perf_hooks";
import { NtsRegExp } from "../../../runtime/ecmascript/src/regexp/builtins.ts";

const iterations = Number(process.argv[2] ?? 10000);
const cases = [
  { name: "literal search", pattern: "needle", flags: "", input: "hay ".repeat(40) + "needle" },
  { name: "capture repetition", pattern: "(a(b)?)+", flags: "", input: "aba".repeat(40) },
  { name: "Unicode property", pattern: "\\p{Letter}+", flags: "u", input: "αβγ".repeat(40) },
  { name: "emoji strings", pattern: "\\p{RGI_Emoji}", flags: "v", input: "👨‍👩‍👧‍👦" },
  { name: "lookbehind", pattern: "(?<=([ab]+)([bc]+))$", flags: "", input: "abc" },
];
function measure(regexp: { exec(input: string): unknown }, input: string): number {
  for (let i = 0; i < 1000; i++) regexp.exec(input);
  const times: number[] = [];
  for (let sample = 0; sample < 5; sample++) {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) regexp.exec(input);
    times.push(((performance.now() - start) * 1000) / iterations);
  }
  times.sort((a, b) => a - b);
  return times[2]!;
}
for (const entry of cases) {
  const native = new RegExp(entry.pattern, entry.flags);
  const shared = new NtsRegExp(entry.pattern, entry.flags);
  const expected = native.exec(entry.input);
  const actual = shared.exec(entry.input);
  if (JSON.stringify(expected) !== JSON.stringify(actual))
    throw new Error("Benchmark result mismatch: " + entry.name);
  const nativeUs = measure(native, entry.input);
  const sharedUs = measure(shared, entry.input);
  console.log(
    JSON.stringify({
      name: entry.name,
      iterations,
      nativeUs,
      sharedUs,
      ratio: sharedUs / nativeUs,
    }),
  );
}
