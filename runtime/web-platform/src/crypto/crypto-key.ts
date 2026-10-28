import type { CryptoKeyHandle, CryptoKeyType } from "../provider/crypto.ts";

/** Web Cryptography Level 2, §13.2: the key's kind and permitted operations. */
export type KeyType = CryptoKeyType;

export type KeyUsage =
  | "encrypt"
  | "decrypt"
  | "sign"
  | "verify"
  | "deriveKey"
  | "deriveBits"
  | "wrapKey"
  | "unwrapKey";

/** Web Cryptography §17. An ordinary dictionary containing two independent keys. */
export interface CryptoKeyPair {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}

function copyUsages(usages: readonly KeyUsage[]): KeyUsage[] {
  const copy: KeyUsage[] = [];
  for (let index = 0; index < usages.length; index++) copy[index] = usages[index]!;
  return copy;
}

/** The ordinary ECMAScript dictionary exposed by CryptoKey.algorithm. */
export interface KeyAlgorithmObject {
  name: string;
}

/**
 * The typed internal KeyAlgorithm dictionary (§12), not its public cached view.
 * Algorithm-specific subclasses copy their nested dictionaries and byte arrays
 * in copy() and toObject(), so neither input aliases nor public mutations can
 * change the key's internal algorithm.
 */
export class KeyAlgorithm {
  readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  copy(): KeyAlgorithm {
    return new KeyAlgorithm(this.name);
  }

  toObject(): KeyAlgorithmObject {
    return { name: this.name };
  }
}

/**
 * Internal key state (§13.3). Only shared cryptographic algorithms import this
 * type and getCryptoKeySlots; these names are not public Web globals.
 */
export class CryptoKeySlots {
  readonly type: KeyType;
  readonly extractable: boolean;
  readonly algorithm: KeyAlgorithm;
  readonly usages: readonly KeyUsage[];
  readonly handle: CryptoKeyHandle;

  constructor(
    type: KeyType,
    extractable: boolean,
    algorithm: KeyAlgorithm,
    usages: readonly KeyUsage[],
    handle: CryptoKeyHandle,
  ) {
    this.type = type;
    this.extractable = extractable;
    this.algorithm = algorithm.copy();
    this.usages = copyUsages(usages);
    this.handle = handle;
  }
}

class CryptoKeyState {
  readonly slots: CryptoKeySlots;
  readonly algorithmCached: KeyAlgorithmObject;
  readonly usagesCached: KeyUsage[];

  constructor(slots: CryptoKeySlots) {
    this.slots = slots;
    // §9's cached ECMAScript objects are mutable snapshots, not frozen values.
    // Make each snapshot once; reading either attribute must preserve identity.
    this.algorithmCached = slots.algorithm.toObject();
    this.usagesCached = copyUsages(slots.usages);
  }
}

const constructorToken = Symbol("CryptoKey construction");
const keyStates = new WeakMap<object, CryptoKeyState>();
// Rule 405266cf7: nts programs cannot replace intrinsic methods. Read the
// private map directly instead of capturing bound copies of its methods.

function keyState(key: unknown): CryptoKeyState {
  if ((typeof key !== "object" || key === null) && typeof key !== "function") {
    throw new TypeError("Value is not a CryptoKey");
  }
  const state = keyStates.get(key);
  if (state === undefined) throw new TypeError("Value is not a CryptoKey");
  return state;
}

/**
 * Web Cryptography Level 2, §§13.3–13.4.
 * https://w3c.github.io/webcrypto/#cryptokey-interface
 *
 * Slots live outside the public instance: property names, symbols, prototype
 * forgeries and expandos cannot reveal its native handle or alter permissions.
 */
export class CryptoKey {
  constructor(token: symbol | undefined = undefined) {
    if (token !== constructorToken) throw new TypeError("Illegal constructor");
  }

  get type(): KeyType {
    return getCryptoKeySlots(this).type;
  }

  get extractable(): boolean {
    return getCryptoKeySlots(this).extractable;
  }

  get algorithm(): KeyAlgorithmObject {
    return keyState(this).algorithmCached;
  }

  get usages(): KeyUsage[] {
    return keyState(this).usagesCached;
  }
}

/**
 * Construct a key after the algorithm's validation and usage normalization.
 * The caller, not the primitive provider or this slot constructor, determines
 * the specification's type, extractability, algorithm and permitted usages.
 */
export function createCryptoKey(
  type: KeyType,
  extractable: boolean,
  algorithm: KeyAlgorithm,
  usages: readonly KeyUsage[],
  handle: CryptoKeyHandle,
): CryptoKey {
  const slots = new CryptoKeySlots(type, extractable, algorithm, usages, handle);
  const state = new CryptoKeyState(slots);
  const key = new CryptoKey(constructorToken);
  keyStates.set(key, state);
  return key;
}

/** Brand-check without reading any author-controlled property of the key. */
export function getCryptoKeySlots(key: unknown): CryptoKeySlots {
  return keyState(key).slots;
}
