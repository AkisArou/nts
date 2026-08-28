// The object node's tests see as `require('buffer')`.
//
// Node's module exports `Buffer` alongside `kMaxLength`, `constants`, `atob`,
// `btoa` and the rest; the class itself is one property, not the module.
export function shape(exports) {
  const mod = { ...exports };
  delete mod.default;
  return mod;
}

// No `installGlobals` here, deliberately, though `Buffer` is a global as well
// as an export. Substituting it changes what *node's own modules* do: `fs`,
// `util.inspect` and the test harness all reach for the global, and none of
// them accepts ours. Tried, and it took buffer from 49 passing to 15. The cost
// is that a test writing `Buffer.concat(...)` unqualified measures node's
// Buffer against our `kMaxLength`, which is a statement about neither; those
// are listed as failures rather than papered over.
