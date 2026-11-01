// Only the value assigned to C differs in the paired control.
function Maker(n:number):number[] { return [91,92,93]; }
const C = Maker as unknown as { new(n:number):number[] };
export function probe(n:number):number { return new C(2).length; }
