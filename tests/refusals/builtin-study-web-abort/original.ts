function main(): void {
  const c = new AbortController(); c.abort(); console.log("a", c.signal.aborted);
}
main();
