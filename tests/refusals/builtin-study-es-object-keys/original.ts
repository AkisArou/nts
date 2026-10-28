function main(): void {
  const o: Record<string, number> = { a: 1, b: 2 }; console.log("o", Object.keys(o).length, Object.entries(o).length);
}
main();
