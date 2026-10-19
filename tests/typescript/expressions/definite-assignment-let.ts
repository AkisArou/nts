/*---
description: A `let` with a definite assignment assertion is read after a function assigns it.
features: [ts-definite-assignment]
---*/
let port!: number;
let host!: string;
function configure(): void {
  port = 8080;
  host = "example";
}
configure();
assert.sameValue(port + 1, 8081);
assert.sameValue(host.length, 7);
