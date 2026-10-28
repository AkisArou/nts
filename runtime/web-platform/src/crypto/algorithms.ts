import { DOMException } from "../core/errors.ts";
import { coerceToDOMString } from "../core/webidl.ts";
import type { CryptoDigestName } from "../provider/crypto.ts";

/** Web Cryptography §11. Objects are not converted to dictionaries until normalization. */
export type AlgorithmIdentifier = string | object;

/** The operations in Web Cryptography §18.2.2, including deriveKey's internal operation. */
export type CryptoOperation =
  | "encrypt"
  | "decrypt"
  | "sign"
  | "verify"
  | "digest"
  | "generateKey"
  | "deriveBits"
  | "importKey"
  | "exportKey"
  | "wrapKey"
  | "unwrapKey"
  | "get key length";

/** Typed IDL dictionary; later algorithm dictionaries extend this layout. */
export class Algorithm {
  readonly name: string;

  constructor(name: string) {
    this.name = name;
  }
}

/** SHA's registration (§32.2) uses Algorithm, with no additional members. */
export class DigestAlgorithm extends Algorithm {
  override readonly name: CryptoDigestName;

  constructor(name: CryptoDigestName) {
    super(name);
    this.name = name;
  }
}

class AlgorithmRegistration {
  readonly name: CryptoDigestName;
  readonly operation: CryptoOperation;

  constructor(name: CryptoDigestName, operation: CryptoOperation) {
    this.name = name;
    this.operation = operation;
  }
}

// §18.4.2's supportedAlgorithms. Register only operations implemented by this
// increment: a future primitive contract is not an implemented Web algorithm.
const registeredAlgorithms: readonly AlgorithmRegistration[] = [
  new AlgorithmRegistration("SHA-1", "digest"),
  new AlgorithmRegistration("SHA-256", "digest"),
  new AlgorithmRegistration("SHA-384", "digest"),
  new AlgorithmRegistration("SHA-512", "digest"),
];

/** Web IDL's (object or DOMString) union conversion, before later argument conversions. */
export function toAlgorithmIdentifier(value: unknown): AlgorithmIdentifier {
  if ((typeof value === "object" && value !== null) || typeof value === "function") {
    return value;
  }
  return coerceToDOMString(value);
}

function algorithmName(algorithm: object): string {
  // The specification passes an arbitrary object. One ordinary Get, followed
  // by required-member validation and DOMString conversion, is observable.
  const name: unknown = (algorithm as { readonly name?: unknown }).name;
  if (name === undefined) throw new TypeError("Algorithm.name is required");
  return coerceToDOMString(name);
}

function equalIgnoringASCIICase(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    let code = left.charCodeAt(index);
    let expected = right.charCodeAt(index);
    if (code >= 0x61 && code <= 0x7a) code -= 0x20;
    if (expected >= 0x61 && expected <= 0x7a) expected -= 0x20;
    if (code !== expected) return false;
  }
  return true;
}

/**
 * Web Cryptography §18.4.4, https://w3c.github.io/webcrypto/#algorithm-normalization.
 * The initial Algorithm conversion and the registered dictionary conversion
 * are separate: a supported object's name getter and coercion run twice.
 */
export function normalizeAlgorithm(
  value: AlgorithmIdentifier,
  operation: CryptoOperation,
): DigestAlgorithm {
  const algorithm = typeof value === "string" ? new Algorithm(value) : value;
  const name = algorithmName(algorithm);
  for (let index = 0; index < registeredAlgorithms.length; index++) {
    const registration = registeredAlgorithms[index]!;
    if (registration.operation !== operation || !equalIgnoringASCIICase(name, registration.name)) continue;
    // Conversion to the desired type (Algorithm for SHA) can still throw or
    // invoke script. Its name is then overwritten with the canonical first match.
    algorithmName(algorithm);
    return new DigestAlgorithm(registration.name);
  }
  throw new DOMException("The algorithm is not supported for " + operation, "NotSupportedError");
}
