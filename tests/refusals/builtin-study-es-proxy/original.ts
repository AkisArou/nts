function main(): void {
  const p = new Proxy({ a: 1 }, {}); console.log("p", p.a);
}
main();
