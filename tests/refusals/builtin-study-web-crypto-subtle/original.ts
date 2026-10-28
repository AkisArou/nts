function main(): void {
  crypto.subtle.digest("SHA-256", new Uint8Array(1)).then((b) => console.log("c", b.byteLength));
}
main();
