function main(): void {
  class K {} const k = new K(); const w = new WeakRef(k); console.log("w", w.deref() === k);
}
main();
