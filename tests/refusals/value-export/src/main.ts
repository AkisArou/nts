// expect: emit-c --napi -> publishes version
//
// FIXED, and kept as a regression guard. A string constant as a module export.
// The addon used to publish the function beside it and not this, so a module
// could pass every test it had while its surface was missing a name -- which was
// exactly `punycode`, whose `version` node's own test never touches. It was the
// last incompleteness in the first module to reach a compiled test.
//
// The resolution was wrong in two ways and both are fixed: it named another
// module's global rather than this one's, and it reported a global as a missing
// function. "No function answers to this name" was never the same claim as
// "this export is absent", and the annotation now has three answers where it
// had two.
//
// Worth keeping because the failure was invisible from the pass count. The
// module was green on both its tests with a name missing from its surface, so
// `sweep.mjs` annotates a green row with whatever its `shape.mjs` needs and the
// addon does not publish. That annotation existed for this.
export const version = "2.1.0";

export function decode(input: string): string {
  return input;
}
