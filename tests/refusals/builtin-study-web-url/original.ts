function main(): void {
  const u = new URL("https://a.example/b?c=1"); console.log("u", u.hostname, u.searchParams.get("c"));
}
main();
