// The collector and allocation choose the same contextual owner, including
// array elements. Both entries retain their independently captured values.
interface Source { read(): number }
export function result(n: number): number {
  const base = n;
  const sources: Source[] = [
    { read(): number { return base; } },
    { read(): number { return 2; } },
  ];
  return sources[0]!.read() + sources[1]!.read();
}
