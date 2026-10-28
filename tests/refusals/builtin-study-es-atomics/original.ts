function main(): void {
  const a = new Int32Array(new SharedArrayBuffer(8)); console.log("a", Atomics.add(a, 0, 1));
}
main();
