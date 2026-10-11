// run: check
// TypeScript accepts the bivariant method. Its authored literal parameter
// cannot license integer specialization for every input the wider face takes.
interface Sink { take(x: number): number }
interface Wide { take(x: number | string): number }
function use(sink: Sink, n: number): number { return sink.take(n); }
const literal: Wide = { take(x: 3): number { return x; } };
export function result(n: number): number { return use(literal, n); }
