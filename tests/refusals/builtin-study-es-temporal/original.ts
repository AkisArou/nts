function main(): void {
  console.log("t", Temporal.Now.instant().epochMilliseconds > 0);
}
main();
