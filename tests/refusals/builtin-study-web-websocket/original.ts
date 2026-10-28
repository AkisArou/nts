function main(): void {
  const w = new WebSocket("ws://127.0.0.1:9/"); console.log("w", w.readyState);
}
main();
