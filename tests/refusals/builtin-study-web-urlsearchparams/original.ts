function main(): void {
  const s = new URLSearchParams("a=1&b=2"); console.log("u", s.get("b"));
}
main();
