function main(): void {
  try { throw new TypeError("x"); } catch (e) { console.log("e", e instanceof TypeError); }
}
main();
