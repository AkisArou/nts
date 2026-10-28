function main(): void {
  const s = new ReadableStream<number>(); console.log("s", s.locked);
}
main();
