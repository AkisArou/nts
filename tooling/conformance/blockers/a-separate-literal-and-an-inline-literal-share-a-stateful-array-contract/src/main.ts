// expect: emit-jvm -> `Sink` carries state
// Main f6811e8f refuses Sink#take. 7c0ad8c7 newly reaches the call but
// aborts on aastore of the separate literal into the own-layout Sink array.
// Two literals of one shape with different closures, through one interface.
interface Sink { take(x: number): number; }
function call(s: Sink, n: number): number { return s.take(n); }
export function twoClosures(n: number): number {
  const a = { take: (x: number): number => x + 1 };
  const b = { take: (x: number): number => x * 2 };
  const all: Sink[] = [a, b, { take: (x: number): number => x - 3 }];
  let t = 0;
  for (const s of all) t = t * 1000 + call(s, n & 15);
  return t;
}
