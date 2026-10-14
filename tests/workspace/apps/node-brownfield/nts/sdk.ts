// The published surface. Everything here is reachable from JavaScript.
//
// See `apps/node/src/main.ts` for why the fold is written out: `TextEncoder` is
// refused by lowering, and `crypto-core.digest` takes the seed and one value
// because that is the shape of its C.
import { digest, seed } from "@workspace/crypto-core";
import { store } from "@workspace/storage";

function digestOf(value: string): number {
  let folded = seed;
  for (let i = 0; i < value.length; i++) {
    folded = digest(folded, value.charCodeAt(i));
  }
  return folded;
}

export function remember(key: string, value: string): number {
  store().set(key, value);
  return digestOf(value);
}

export { digestOf };
