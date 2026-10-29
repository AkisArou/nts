// The same literal-union parameter, reached only from in-range literal values.
// Unlike an unchecked assertion, these actual arrivals license a bare read.
const table = [10, 20, 30, 40];
function pick(d: 0 | 1 | 2 | 3): number { return table[d] ?? -1; }
export function viaCastIndex(x: number): number { return pick(x > 0 ? 1 : 0); }
