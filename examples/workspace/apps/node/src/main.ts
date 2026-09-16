// A digest over a string's code units, folded one at a time.
//
// **`TextEncoder` is refused by lowering**, so the bytes come from the string
// itself. `crypto-core.digest` takes a seed and a value because that is what its
// C takes -- a `Uint8Array` is not a `ConstPtr<c_uint8>`, which a generated
// binding makes plain and a hand-written signature did not.
import { digest, seed } from "@workspace/crypto-core";
import { store } from "@workspace/storage";

function digestOf(value: string): number {
  let folded = seed;
  for (let i = 0; i < value.length; i++) {
    folded = digest(folded, value.charCodeAt(i));
  }
  return folded;
}

export function putRecord(key: string, value: string): number {
  store().set(key, value);
  return digestOf(value);
}

export { digestOf };
