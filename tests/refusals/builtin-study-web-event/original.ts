function main(): void {
  const t = new EventTarget(); t.addEventListener("x", () => console.log("x")); t.dispatchEvent(new Event("x"));
}
main();
