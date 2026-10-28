import { createHash } from "node:crypto";
import type {
  CryptoDigestName,
  CryptoDigestProvider,
  CryptoFailure,
} from "../src/provider/crypto.ts";

const ByteArray = Uint8Array;

/** Test-only native primitives. No Web Crypto implementation is called here. */
export class NodeCryptoProvider implements CryptoDigestProvider {
  digest(algorithm: CryptoDigestName, bytes: Uint8Array): Uint8Array | CryptoFailure {
    try {
      const result = createHash(algorithm.toLowerCase().replace("-", ""))
        .update(bytes)
        .digest();
      // Buffer can use a shared allocation. Transfer an independently owned,
      // exactly sized ArrayBuffer to the package, as the primitive contract requires.
      return new ByteArray(result);
    } catch {
      return { failure: "operation" };
    }
  }
}
