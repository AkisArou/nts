function main(): void {
  fetch("http://127.0.0.1:9/").then((r) => console.log("f", r.status), () => console.log("f", "failed"));
}
main();
