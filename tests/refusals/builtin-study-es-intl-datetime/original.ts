function main(): void {
  console.log("i", new Intl.DateTimeFormat("en-US", { timeZone: "UTC" }).format(new Date(0)));
}
main();
