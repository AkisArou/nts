// Not exported, so every caller is inside the compiled program and the analysis
// can see all of them. Its parameter is bounded by what they pass, and its
// callers' values are bounded by what it returns.
function clamp(v: number): number {
  return v & 255;
}

function twice(n: number): number {
  return n + n;
}

export function pipeline(rounds: 64): number {
  let total = 0;
  for (let i = 0; i < rounds; i++) {
    total = twice(clamp(total + i));
  }
  return total;
}

// Exported, so its parameter stays as wide as its declared type however few
// callers happen to be visible here. The next one is a linker away.
export function exposed(v: number): number {
  return clamp(v);
}

// Nothing exported reaches this, so it is dropped before any analysis runs --
// it costs no interprocedural pass, no specialization, no bounds proof and no
// codegen. The linker would also drop it, but only after all of that.
function neverCalled(v: number): number {
  return v * 3 + 1;
}

// ...and neither is this, even though `neverCalled` calls it. Reachability is
// from the exports, not from "is called by something".
function onlyCalledByTheUnreachable(v: number): number {
  return neverCalled(v) + 1;
}
