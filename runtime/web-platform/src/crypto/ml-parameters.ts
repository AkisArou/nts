import type { CryptoMlAlgorithmName } from "../provider/crypto.ts";

/** Modern Algorithms §8: FIPS 204 encoded widths, not cryptographic operations. */
export function isMlAlgorithm(name: string): name is CryptoMlAlgorithmName {
  return name === "ML-DSA-44" || name === "ML-DSA-65" || name === "ML-DSA-87";
}

export function mlPublicKeyLength(name: CryptoMlAlgorithmName): number {
  return name === "ML-DSA-44" ? 1312 : name === "ML-DSA-65" ? 1952 : 2592;
}

export function mlSeedLength(_name: CryptoMlAlgorithmName): number { return 32; }

export function mlExpandedKeyLength(name: CryptoMlAlgorithmName): number {
  return name === "ML-DSA-44" ? 2560 : name === "ML-DSA-65" ? 4032 : 4896;
}

export function mlSignatureLength(name: CryptoMlAlgorithmName): number {
  return name === "ML-DSA-44" ? 2420 : name === "ML-DSA-65" ? 3309 : 4627;
}
