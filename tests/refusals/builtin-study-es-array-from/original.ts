function main(): void {
  console.log("a", Array.from({ length: 3 }, (_, i) => i).join(","));
}
main();
