import type { CryptoOkpCurve } from "../provider/crypto.ts";

/**
 * RFC 8032 §§5.1.2, 5.2.2, 5.2.5 and RFC 7748 §5. These widths cover the
 * encoded public key and the original private seed, not a decoded field element.
 * The Secure Curves draft's Ed448 raw-import step says 448 bits in error:
 * RFC 8032's Ed448 encoding is 57 octets (456 bits), including its sign bit.
 * https://www.rfc-editor.org/rfc/rfc8032#section-5.2.2
 */
export function okpCurveByteLength(namedCurve: CryptoOkpCurve): number {
  switch (namedCurve) {
    case "Ed25519":
    case "X25519": return 32;
    case "Ed448": return 57;
    case "X448": return 56;
  }
}

/** Edwards signatures and Montgomery agreement use distinct key usages/JWK policy. */
export function isEdwardsCurve(namedCurve: CryptoOkpCurve): boolean {
  return namedCurve === "Ed25519" || namedCurve === "Ed448";
}
