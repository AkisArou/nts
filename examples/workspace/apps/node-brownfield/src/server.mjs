// Ordinary Node. `@acme/sdk` is TypeScript compiled to C and loaded as a native
// addon, and nothing here can tell -- which is the only thing a brownfield
// consumer should have to know.
import { remember, digest } from "@acme/sdk";

remember("started", String(Date.now()));
console.log(digest(new TextEncoder().encode("acme")));
