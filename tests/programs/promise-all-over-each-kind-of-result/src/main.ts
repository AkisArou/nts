// `Promise.all` over each kind of result its array can hold. The C runtime
// stored a settled value as a reference if the array held references and as a
// `double` otherwise, so an erased array (16-byte tagged values) read every
// element back as `undefined`, and a boolean array (one byte a slot) took
// eight bytes a slot: three booleans wrote 24 bytes into 3, and the program
// died of the heap it corrupted. It stores by the array's element kind now.
// The JVM runtime had no boolean entry (`NoSuchMethodError`) and stored an
// erased array's payloads alone (`ArrayStoreException` on the string); it
// stores by the same rule now. `promise-all-in-a-program-that-grows-an-array`
// is the same four arms in a program whose arrays are the JVM's wrappers.
//
// `numbers` is the control: doubles in a double array, which agreed.

async function settle<T>(value: T): Promise<T> {
  return await value;
}

export async function booleans(n: number): Promise<string> {
  const r = await Promise.all([settle(n > 0), settle(n > 1), settle(n > 2)]);
  return r.map((b) => (b ? "t" : "f")).join("");
}

export async function erased(n: number): Promise<string> {
  const r = await Promise.all([settle<any>(n), settle<any>(`s${n}`), settle<any>(n > 1)]);
  return `${r[0]},${r[1]},${r[2]}`;
}

export async function strings(n: number): Promise<string> {
  const r = await Promise.all([settle(`a${n}`), settle(`b${n}`)]);
  return r.join("");
}

export async function numbers(n: number): Promise<number> {
  const r = await Promise.all([settle(n), settle(n + 1), settle(n * 2)]);
  return r[0] + r[1] * 10 + r[2] * 100;
}
