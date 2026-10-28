function main(): void {
  const h = new Headers(); h.set("a", "b"); console.log("h", h.get("a"));
}
main();
