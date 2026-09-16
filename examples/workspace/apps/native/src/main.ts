// A CLI. The narrowest artifact here: one portable C package, no host.
//
// **Top-level code, because that is what an executable runs.** This exported a
// `main()` that nothing called, and an executable's roots are module evaluation
// -- so every line of it was pruned and the artifact was a program that did
// nothing at all. `examples/standalone` states the rest: a compiled program has
// nothing to print with, so termination and exit zero is the assertion.
import { digest, seed } from "@workspace/crypto-core";

let checksum = seed;

for (let i = 0; i < 4; i++) {
  checksum = digest(checksum, i);
}
