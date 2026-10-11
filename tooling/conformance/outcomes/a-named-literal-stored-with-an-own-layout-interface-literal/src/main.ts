// run: check
// backend: jvm
// Main f6811e8f and 7c0ad8c7 crash on container reads; C agrees on all cases.
interface Sink { take(x: number): number; }
const own: Sink = { take: (x: number): number => x - 3 };
function fresh() { return { take: (x: number): number => x + 1 }; }
function first(all: Sink[], n: number): number { return all[0].take(n); }
export function literal(n: number): number { const a = fresh(); const all: Sink[] = [a, own]; return first(all, n); }
export function index(n: number): number { const all: Sink[] = [own]; all[0] = fresh(); return first(all, n); }
export function push(n: number): number { const all: Sink[] = [own]; all.push(fresh()); return all[1].take(n); }
export function unshift(n: number): number { const all: Sink[] = [own]; all.unshift(fresh()); return first(all, n); }
export function fill(n: number): number { const all: Sink[] = [own]; all.fill(fresh()); return first(all, n); }
export function concat(n: number): number { const all: Sink[] = [own]; const other = [fresh()]; return all.concat(other)[1].take(n); }
export function map(n: number): number { const all = new Map<string, Sink>(); all.set("own", own); all.set("value", fresh()); const got = all.get("value"); return got ? got.take(n) : 0; }
export function set(n: number): number { const all = new Set<Sink>(); all.add(own); all.add(fresh()); let result = 0; for (const got of all) result += got.take(n); return result; }
export async function promise(n: number): Promise<number> { const got: Sink = await Promise.resolve<Sink>(fresh()); return got.take(n) + own.take(n); }
