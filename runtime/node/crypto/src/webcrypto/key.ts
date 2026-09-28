// Web Crypto's `CryptoKey`, from node v24.20.0 `lib/internal/crypto/keys.js`
// (`createCryptoKeyClass` and its slot helpers) and `util.js`'s usage masks.
//
// Node's key is a native object whose slots live in C++; here they live in a
// private field, which is as unforgeable: a prototype set by hand, a
// `Symbol.hasInstance`, or another class's instance reaches none of them.
// `CryptoKey` cannot be constructed by a program, as in node -- only with a
// token this module holds -- and every key is an `InternalCryptoKey`, whose
// prototype chain runs through `CryptoKey.prototype` and whose `constructor`
// names `CryptoKey`. The descriptors node gives the prototype (enumerable
// getters, a `toStringTag`) are metadata a class cannot spell; `shape.mjs`
// applies them.

import { registerCryptoKeyBrand } from "../../../internal/brands.ts";
import { ERR_ILLEGAL_CONSTRUCTOR, ERR_INVALID_THIS } from "../../../internal/errors.ts";
import { customInspectSymbol, inspect, type InspectOptions } from "../../../util/src/inspect.ts";
import type { KeyObjectHandle, KeyObjectType } from "../keys.ts";

/** A key's `[[algorithm]]`: the members its family has, and no others. */
export interface KeyAlgorithm {
  name: string;
  length?: number;
  hash?: { name: string };
  namedCurve?: string;
  modulusLength?: number;
  publicExponent?: Uint8Array;
}

/** Node's canonical order of the usages, which is also each one's bit in a mask. */
const kCanonicalUsageOrder = [
  "encrypt",
  "decrypt",
  "sign",
  "verify",
  "deriveKey",
  "deriveBits",
  "wrapKey",
  "unwrapKey",
  "encapsulateKey",
  "encapsulateBits",
  "decapsulateKey",
  "decapsulateBits",
] as const;

export type KeyUsage = (typeof kCanonicalUsageOrder)[number];

/** A usage's bit, or 0 for a name that is none. */
export function usageMask(usage: string): number {
  const index = (kCanonicalUsageOrder as readonly string[]).indexOf(usage);
  return index < 0 ? 0 : 1 << index;
}

/** Node's `getUsagesMask`. */
export function getUsagesMask(usages: Iterable<string>): number {
  let mask = 0;
  for (const usage of usages) mask |= usageMask(usage);
  return mask;
}

/** Node's `hasUsage`. */
export function hasUsage(mask: number, usage: string): boolean {
  return (mask & usageMask(usage)) !== 0;
}

/** Node's `getUsagesFromMask`: the usages in canonical order. */
export function getUsagesFromMask(mask: number): KeyUsage[] {
  const usages: KeyUsage[] = [];
  for (let n = 0; n < kCanonicalUsageOrder.length; n++) {
    if (mask & (1 << n)) usages.push(kCanonicalUsageOrder[n]!);
  }
  return usages;
}

/** Node's `cloneAlgorithm`: a plain copy a program may change freely. */
function cloneAlgorithm(raw: KeyAlgorithm): KeyAlgorithm {
  const cloned: KeyAlgorithm = { ...raw };
  if (Object.hasOwn(cloned, "hash") && cloned.hash !== undefined) cloned.hash = { ...cloned.hash };
  if (Object.hasOwn(cloned, "publicExponent") && cloned.publicExponent !== undefined) {
    cloned.publicExponent = new Uint8Array(cloned.publicExponent);
  }
  return cloned;
}

/**
 * Node's `cloneInternalAlgorithm`: the slot's own copy, with no prototype, so
 * a property a program puts on `Object.prototype` is never read as a member.
 */
function cloneInternalAlgorithm(raw: KeyAlgorithm): KeyAlgorithm {
  const cloned = Object.assign(Object.create(null) as KeyAlgorithm, raw);
  if (Object.hasOwn(cloned, "hash") && cloned.hash !== undefined) {
    cloned.hash = Object.assign(Object.create(null) as { name: string }, cloned.hash);
  }
  if (Object.hasOwn(cloned, "publicExponent") && cloned.publicExponent !== undefined) {
    cloned.publicExponent = new Uint8Array(cloned.publicExponent);
  }
  return cloned;
}

/** What node's native `CryptoKey` holds. */
class CryptoKeySlots {
  readonly type: KeyObjectType;
  readonly extractable: boolean;
  readonly algorithm: KeyAlgorithm;
  readonly usagesMask: number;
  readonly handle: KeyObjectHandle;
  clonedAlgorithm: KeyAlgorithm | undefined = undefined;
  clonedUsages: KeyUsage[] | undefined = undefined;
  usages: KeyUsage[] | undefined = undefined;

  constructor(
    type: KeyObjectType,
    extractable: boolean,
    algorithm: KeyAlgorithm,
    usagesMask: number,
    handle: KeyObjectHandle,
  ) {
    this.type = type;
    this.extractable = extractable;
    this.algorithm = algorithm;
    this.usagesMask = usagesMask;
    this.handle = handle;
  }
}

/** The slot readers, filled in as `CryptoKey` is defined -- see `KeyObjectSlots` in `keys.ts`. */
class SlotAccess {
  brand: ((value: object) => boolean) | null = null;
  slots: ((key: CryptoKey) => CryptoKeySlots) | null = null;
}

const access = new SlotAccess();

/** Whether a value is a key this module made: node's `isCryptoKey`. */
export function isCryptoKey(value: unknown): value is CryptoKey {
  return typeof value === "object" && value !== null && access.brand!(value);
}

/** Node's `getSlots`: a key's slots, or `ERR_INVALID_THIS` for anything else. */
function slotsOf(key: unknown): CryptoKeySlots {
  if (!isCryptoKey(key)) throw new ERR_INVALID_THIS("CryptoKey");
  return access.slots!(key);
}

/**
 * What only this module holds: the argument that makes the constructor build
 * a key rather than refuse, as node's native constructor is out of a
 * program's reach.
 */
class Construction {}

const construction = new Construction();

export class CryptoKey {
  static {
    access.brand = (value: object): boolean => #slots in value;
    access.slots = (key: CryptoKey): CryptoKeySlots => key.#slots;
    registerCryptoKeyBrand(access.brand);
  }

  readonly #slots: CryptoKeySlots;

  constructor(token?: unknown, slots?: CryptoKeySlots) {
    if (token !== construction || slots === undefined) throw new ERR_ILLEGAL_CONSTRUCTOR();
    this.#slots = slots;
  }

  [customInspectSymbol](depth: number, options: InspectOptions): unknown {
    if (depth < 0) return this;
    const nested: InspectOptions = {
      ...options,
      depth: options.depth == null ? null : options.depth - 1,
    };
    const summary = {
      type: getCryptoKeyType(this),
      extractable: getCryptoKeyExtractable(this),
      algorithm: cloneAlgorithm(getCryptoKeyAlgorithm(this)),
      usages: getCryptoKeyUsages(this).slice(),
    };
    return `CryptoKey ${inspect(summary, nested)}`;
  }

  get type(): KeyObjectType {
    return getCryptoKeyType(this);
  }

  get extractable(): boolean {
    return getCryptoKeyExtractable(this);
  }

  /** A copy, made once: a program's change to it is seen by its next read and by nothing else. */
  get algorithm(): KeyAlgorithm {
    const slots = slotsOf(this);
    return (slots.clonedAlgorithm ??= cloneAlgorithm(slots.algorithm));
  }

  /** The same for the usages. */
  get usages(): KeyUsage[] {
    const slots = slotsOf(this);
    return (slots.clonedUsages ??= usagesOf(slots).slice());
  }
}

/**
 * The class every key is an instance of. Node's keys have one between them
 * and `CryptoKey.prototype` too -- its native class, hidden the same way:
 * the prototype says it is `CryptoKey`'s.
 */
class InternalCryptoKey extends CryptoKey {
  override get ["constructor"](): unknown {
    return CryptoKey;
  }
}

/** A new key: node's `new InternalCryptoKey(handle, algorithm, usagesMask, extractable)`. */
export function createCryptoKey(
  type: KeyObjectType,
  handle: KeyObjectHandle,
  algorithm: KeyAlgorithm,
  usages: Iterable<string>,
  extractable: boolean,
): CryptoKey {
  const slots = new CryptoKeySlots(type, extractable, cloneInternalAlgorithm(algorithm), getUsagesMask(usages), handle);
  return new InternalCryptoKey(construction, slots);
}

function usagesOf(slots: CryptoKeySlots): KeyUsage[] {
  return (slots.usages ??= getUsagesFromMask(slots.usagesMask));
}

/** `[[type]]`, read from the slot rather than through the replaceable getter. */
export function getCryptoKeyType(key: unknown): KeyObjectType {
  return slotsOf(key).type;
}

/** `[[extractable]]`. */
export function getCryptoKeyExtractable(key: unknown): boolean {
  return slotsOf(key).extractable;
}

/** `[[algorithm]]`: the slot's own copy, not the program's. */
export function getCryptoKeyAlgorithm(key: unknown): KeyAlgorithm {
  return slotsOf(key).algorithm;
}

/** `[[usages]]` in canonical order: the slot's own list, not the program's. */
export function getCryptoKeyUsages(key: unknown): KeyUsage[] {
  return usagesOf(slotsOf(key));
}

/** The usage mask. */
export function getCryptoKeyUsagesMask(key: unknown): number {
  return slotsOf(key).usagesMask;
}

/** Whether `[[usages]]` has `usage`. */
export function hasCryptoKeyUsage(key: unknown, usage: string): boolean {
  return hasUsage(slotsOf(key).usagesMask, usage);
}

/** The key material. */
export function getCryptoKeyHandle(key: unknown): KeyObjectHandle {
  return slotsOf(key).handle;
}
