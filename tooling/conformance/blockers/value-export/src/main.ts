// expect: emit-c --napi -> no wrapper for version: is exported and is not a
//         function this backend can name
//
// A string constant as a module export. The addon publishes the function beside
// it and not this, so a module can pass every test it has while its surface is
// missing a name -- which is exactly `punycode`, whose `version` node's own test
// never touches.
//
// This is the last incompleteness in the first module to reach a compiled test,
// so it is here to be visible rather than because anything is blocked on it.
// `sweep.mjs` annotates a green row with the names its `shape.mjs` needs and the
// addon does not publish, for the same reason.
export const version = "2.1.0";

export function decode(input: string): string {
  return input;
}
