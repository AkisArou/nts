// `JSON.stringify` of an `unknown` narrowed to a string: the shape of node's
// `determineSpecificType` (`internal/errors.ts`), which reports a string
// argument as `type string ('abc')` and switches to `JSON.stringify` when the
// value holds a single quote, so the message stays parseable.
//
// It was the `json-stringify` refusal fixture, NTS1100 while this compiler
// provided no `JSON.stringify` -- the head of the longest refusal chain in the
// node profile, under every argument check that imports `internal/errors.ts`.
// The narrowed value is a string, so the generated writer for a string quotes
// it (`hir/lower/json.rs`).

export function describe(value: unknown): string {
  if (typeof value === "string") {
    if (value.indexOf("'") === -1) {
      return `type string ('${value}')`;
    }
    return `type string (${JSON.stringify(value)})`;
  }
  return "not a string";
}

const SAMPLES = ["it's", "plain", 'say "hi"', "tab\tand 'quote'", "line\nbreak's"];

export function described(seed: number): number {
  const text = describe(SAMPLES[(seed | 0) & 3] as string);
  let h = 7;
  for (let i = 0; i < text.length; i++) {
    h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
  }
  return h;
}

for (const sample of SAMPLES) {
  console.log(describe(sample));
}
console.log(describe(42));
