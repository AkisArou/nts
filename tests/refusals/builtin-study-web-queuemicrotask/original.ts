function main(): void {
  queueMicrotask(() => console.log("m"));
}
main();
