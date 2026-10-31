// expect: NTS1001 `Map#values`, which needs the iteration protocol
// Node v26.13.0 internal/zip/buffer.js and internal/zip/file.js return
// Map.values()/entries() iterators. The producer needs iteration-protocol
// support under the pilot compiler. The control changes only the final
// expression to the same map's numeric size; both maps contain one entry.
// Neither function runs at module scope, so this fixture introduces no cut.

export function iteratorFactory(n: number) {
  const values = new Map<string, number>();
  values.set("entry", n);
  return values.values();
}

export function sizeFactory(n: number) {
  const values = new Map<string, number>();
  values.set("entry", n);
  return values.size;
}
