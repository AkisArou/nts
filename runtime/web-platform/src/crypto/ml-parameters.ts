import type { CryptoMlAlgorithmName, CryptoMlDsaName, CryptoMlKemName } from "../provider/crypto.ts";

/** Modern Algorithms §§6, 8: encoded widths, not cryptographic operations. */
export function isMlDsaAlgorithm(name: string): name is CryptoMlDsaName {
  return name === "ML-DSA-44" || name === "ML-DSA-65" || name === "ML-DSA-87";
}

export function isMlKemAlgorithm(name: string): name is CryptoMlKemName {
  return name === "ML-KEM-512" || name === "ML-KEM-768" || name === "ML-KEM-1024";
}

export function isMlAlgorithm(name: string): name is CryptoMlAlgorithmName {
  return isMlDsaAlgorithm(name) || isMlKemAlgorithm(name);
}

export function mlPublicKeyLength(name: CryptoMlAlgorithmName): number {
  if (isMlKemAlgorithm(name)) return name === "ML-KEM-512" ? 800 : name === "ML-KEM-768" ? 1184 : 1568;
  return name === "ML-DSA-44" ? 1312 : name === "ML-DSA-65" ? 1952 : 2592;
}

export function mlSeedLength(name: CryptoMlAlgorithmName): number { return isMlKemAlgorithm(name) ? 64 : 32; }

export function mlExpandedKeyLength(name: CryptoMlAlgorithmName): number {
  if (isMlKemAlgorithm(name)) return name === "ML-KEM-512" ? 1632 : name === "ML-KEM-768" ? 2400 : 3168;
  return name === "ML-DSA-44" ? 2560 : name === "ML-DSA-65" ? 4032 : 4896;
}

export function mlSignatureLength(name: CryptoMlDsaName): number {
  return name === "ML-DSA-44" ? 2420 : name === "ML-DSA-65" ? 3309 : 4627;
}

export function mlCiphertextLength(name: CryptoMlKemName): number {
  return name === "ML-KEM-512" ? 768 : name === "ML-KEM-768" ? 1088 : 1568;
}

/** Modern Algorithms §6.4.3, in bits. No truncation is performed by the KEM. */
export function getMlKemSharedKeyLength(): number { return 256; }
