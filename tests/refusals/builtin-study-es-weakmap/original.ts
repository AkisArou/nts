function main(): void {
  class K {} const w = new WeakMap<K, number>(); const k = new K(); w.set(k, 1); console.log("w", w.get(k));
}
main();
