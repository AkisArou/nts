function main(): void {
  const d = new TextDecoder().decode(new Uint8Array([104, 105])); console.log("t", d);
}
main();
