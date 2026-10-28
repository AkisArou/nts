import type { CryptoProvider } from "../provider/crypto.ts";
import type { Crypto } from "./crypto.ts";

// Identity is the only key property inspected. The object-keyed reader can
// reject an unregistered object without invoking any public Crypto accessor;
// registration itself accepts only the internally constructed Crypto layout.
const cryptoCapabilities = new WeakMap<object, CryptoProvider>();

export function associateCryptoCapability(crypto: Crypto, provider: CryptoProvider): void {
  cryptoCapabilities.set(crypto, provider);
}

/** Module-internal state for Modern Algorithms §3.2.6, never a public member. */
export function cryptoCapability(crypto: object): CryptoProvider | undefined {
  return cryptoCapabilities.get(crypto);
}
