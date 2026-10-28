import type { CryptoNamedCurve } from "../provider/crypto.ts";

/** SEC 1 §2.3.5 / RFC 7518 §6.2: field elements occupy the full curve width. */
export function ecCurveByteLength(namedCurve: CryptoNamedCurve): number {
  switch (namedCurve) {
    case "P-256": return 32;
    case "P-384": return 48;
    case "P-521": return 66;
  }
}
