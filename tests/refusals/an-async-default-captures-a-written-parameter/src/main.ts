// expect: emit-c -> NTS2006 a field operation on something that is not an object
// The constant default is the one-change control; this callable has no parameter entry yet.
async function subjectBody(x: number, read = () => x): Promise<number> { x = 2; return read(); }
async function controlBody(x: number, read = () => 2): Promise<number> { x = 2; return read(); }
export async function subject(n: number): Promise<number> { return await subjectBody(n | 0); }
export async function control(n: number): Promise<number> { return await controlBody(n | 0); }
