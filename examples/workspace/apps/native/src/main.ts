// A CLI. The narrowest artifact here: one portable C package, no host.
import { digest } from "@workspace/crypto-core";

export function main(): void {
  const bytes = new TextEncoder().encode("workspace");
  console.log(digest(bytes));
}
