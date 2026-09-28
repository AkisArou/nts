// `KeyObject` and its secret kind, from node v24.20.0
// `lib/internal/crypto/keys.js` and `src/crypto/crypto_keys.cc`.
//
// A secret key is bytes and nothing else, so its handle is the bytes: no
// OpenSSL object stands behind it, and there is nothing native to free. The
// handle class is never exported, which is what makes node's constructor
// check mean the same here -- a program cannot build a `KeyObject` from
// anything but a key this module made.
//
// Public and private keys are the asymmetric half, which is an OpenSSL
// `EVP_PKEY` and not yet part of this module.

import { Buffer } from "../../buffer/src/main.ts";
import {
  ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE,
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_ARG_VALUE,
} from "../../internal/errors.ts";
import { validateObject, validateOneOf } from "../../internal/validators.ts";
import { isAnyArrayBuffer, isArrayBufferView } from "../../util/src/types.ts";
import { bytesOf, getArrayBufferOrView } from "./util.ts";

export type KeyObjectType = "secret" | "public" | "private";

/** Key material, held privately. The secret kind is its bytes. */
class KeyObjectHandle {
  readonly #bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.#bytes = bytes;
  }

  get bytes(): Uint8Array {
    return this.#bytes;
  }

  /** `KeyObjectHandle::Equals` for two secrets: length, then constant time. */
  equals(other: KeyObjectHandle): boolean {
    const a = this.#bytes;
    const b = other.#bytes;
    return a.byteLength === b.byteLength && nts_crypto_timing_safe_equal(a, b);
  }
}

/**
 * A key's slots, for this module's own readers -- node's `getKeyObjectHandle`
 * and `getKeyObjectType`.
 *
 * Read from inside the class, because only the class can read its `#` fields,
 * and never through the `type` getter, which is a configurable property a
 * program can replace (`test-crypto-keyobject-hidden-slots`). Not a static
 * method either, which would hand the key material to anyone holding the
 * exported class. The class fills these in as it is defined; they are fields
 * of an object rather than module-scope functions because the compiled lane
 * can store a closure in a field and cannot in a module-scope name.
 */
class KeyObjectSlots {
  handle: ((key: KeyObject) => KeyObjectHandle) | null = null;
  type: ((key: KeyObject) => KeyObjectType) | null = null;
}

const slots = new KeyObjectSlots();

function handleOf(key: KeyObject): KeyObjectHandle {
  return slots.handle!(key);
}

function typeOf(key: KeyObject): KeyObjectType {
  return slots.type!(key);
}

export class KeyObject {
  static {
    slots.handle = (key: KeyObject): KeyObjectHandle => key.#handle;
    slots.type = (key: KeyObject): KeyObjectType => key.#type;
  }

  readonly #type: KeyObjectType;
  readonly #handle: KeyObjectHandle;

  constructor(type: unknown, handle: unknown) {
    if (type !== "secret" && type !== "public" && type !== "private") {
      throw new ERR_INVALID_ARG_VALUE("type", type);
    }
    if (typeof handle !== "object" || !(handle instanceof KeyObjectHandle)) {
      throw new ERR_INVALID_ARG_TYPE("handle", "object", handle);
    }
    this.#type = type;
    this.#handle = handle;
  }

  get type(): KeyObjectType {
    return this.#type;
  }

  /**
   * `KeyObject.from(cryptoKey)`. This profile has no `CryptoKey` yet -- that is
   * Web Crypto's `subtle` -- so nothing a program holds can be one, and every
   * argument is refused as node refuses a value that is not.
   */
  static from(key: unknown): KeyObject {
    throw new ERR_INVALID_ARG_TYPE("key", "CryptoKey", key);
  }

  equals(otherKeyObject: unknown): boolean {
    if (!(otherKeyObject instanceof KeyObject)) {
      throw new ERR_INVALID_ARG_TYPE("otherKeyObject", "KeyObject", otherKeyObject);
    }
    return this.#type === otherKeyObject.#type && this.#handle.equals(otherKeyObject.#handle);
  }
}

export class SecretKeyObject extends KeyObject {
  constructor(handle: unknown) {
    super("secret", handle);
  }

  get symmetricKeySize(): number {
    return handleOf(this).bytes.byteLength;
  }

  export(options?: unknown): Buffer | { kty: string; k: string } {
    const bytes = handleOf(this).bytes;
    if (options !== undefined) {
      validateObject(options, "options");
      const format = (options as { format?: unknown }).format;
      validateOneOf(format, "options.format", [undefined, "buffer", "jwk"]);
      if (format === "jwk") {
        return { kty: "oct", k: Buffer.from(bytes).toString("base64url") };
      }
    }
    return Buffer.from(bytes);
  }
}

/** Node's `getKeyTypes`: the accepted kinds, as the error lists them. */
function keyTypes(allowKeyObject: boolean, bufferOnly: boolean): string[] {
  const types = ["ArrayBuffer", "Buffer", "TypedArray", "DataView", "string", "KeyObject", "CryptoKey"];
  if (bufferOnly) return types.slice(0, 4);
  if (!allowKeyObject) return types.slice(0, 5);
  return types;
}

/**
 * Node's `prepareSecretKey`, answering the bytes: a secret `KeyObject`'s own,
 * or the argument's. Unless `bufferOnly`, a `KeyObject` of another type is
 * refused by name.
 */
export function prepareSecretKey(key: unknown, encoding: string | undefined, bufferOnly = false): Uint8Array {
  if (!bufferOnly && key instanceof KeyObject) {
    const type = typeOf(key);
    if (type !== "secret") throw new ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE(type, "secret");
    return handleOf(key).bytes;
  }
  if (typeof key !== "string" && !isArrayBufferView(key) && !isAnyArrayBuffer(key)) {
    throw new ERR_INVALID_ARG_TYPE("key", keyTypes(!bufferOnly, bufferOnly), key);
  }
  return bytesOf(getArrayBufferOrView(key, "key", encoding));
}

/**
 * `crypto.createSecretKey(key[, encoding])`. The bytes are copied, as
 * `KeyObjectHandle::Init` copies them: a key does not change when the buffer
 * it was made from does.
 */
export function createSecretKey(key: unknown, encoding?: string): SecretKeyObject {
  const bytes = prepareSecretKey(key, encoding, true);
  // Copied into a fresh array, not with `slice`: the bytes may be a `Buffer`,
  // whose `slice` is node's alias for `subarray` and shares them.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new SecretKeyObject(new KeyObjectHandle(copy));
}
