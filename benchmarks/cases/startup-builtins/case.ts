// A small program that reaches the JSON and string builtins: a manifest
// stringified and parsed back, and a string split, mapped, joined, padded and
// replaced. What linking and starting those costs at launch, beside the empty
// and hello rows. tooling/bench/README.md, "Launch rows", says how it is timed.
type Manifest = { name: string; version: number; tags: string[]; nested: { ok: boolean; ratio: number } };

const manifest: Manifest = { name: "nts", version: 1, tags: ["native", "typescript"], nested: { ok: true, ratio: 0.5 } };
const text = JSON.stringify(manifest);
const parsed = JSON.parse(text) as Manifest;
const words = "launch to exit".split(" ").map((word) => word.toUpperCase());
console.log(text.length, parsed.tags.join("+"), words.join("-").padStart(20, "."), parsed.name.replaceAll("n", "N"), parsed.nested.ratio);
