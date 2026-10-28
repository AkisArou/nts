function main(): void {
  const u = new Uint8Array(4); crypto.getRandomValues(u); console.log("c", u.length);
}
main();
