import { DOMException } from "../core/errors.ts";
import { requireArguments } from "../core/webidl.ts";
import type { CryptoProvider } from "../provider/crypto.ts";
import type { RandomSource, Scheduler } from "../provider/primitives.ts";
import {
  cryptoBytes,
  cryptoTypedArrayName,
  cryptoViewByteLength,
  toCryptoArrayBufferView,
} from "./buffer-source.ts";
import { SubtleCrypto } from "./subtle-crypto.ts";

const uuidHex: string[] = [];
for (let byte = 0; byte < 256; byte++) uuidHex.push(byte.toString(16).padStart(2, "0"));
const uuidPoolBytes = 128 * 16;

/** Web Cryptography §10, https://w3c.github.io/webcrypto/#crypto-interface. */
export class Crypto {
  readonly #random: RandomSource;
  readonly #subtle: SubtleCrypto;
  #uuidPool: Uint8Array | undefined;
  #uuidOffset: number;

  /** Tests/embedders construct directly until the runtime-assembly PR. */
  constructor(random: RandomSource, provider: CryptoProvider, scheduler: Scheduler) {
    this.#random = random;
    this.#subtle = new SubtleCrypto(provider, scheduler, random);
    this.#uuidPool = undefined;
    this.#uuidOffset = uuidPoolBytes;
  }

  get subtle(): SubtleCrypto {
    return this.#subtle;
  }

  getRandomValues<T extends ArrayBufferView>(array: T): T {
    const random = this.#random;
    requireArguments(arguments, 1, "Crypto.getRandomValues");
    const view = toCryptoArrayBufferView(array);
    switch (cryptoTypedArrayName(view)) {
      case "Int8Array":
      case "Uint8Array":
      case "Uint8ClampedArray":
      case "Int16Array":
      case "Uint16Array":
      case "Int32Array":
      case "Uint32Array":
      case "BigInt64Array":
      case "BigUint64Array":
        break;
      default:
        throw new DOMException("Expected an integer typed array", "TypeMismatchError");
    }
    if (cryptoViewByteLength(view) > 65_536) {
      throw new DOMException("The array exceeds 65,536 bytes", "QuotaExceededError");
    }
    // No backing-buffer allocation or copy. Non-Uint8 arrays need only a view
    // over the caller's exact byte range; the usual Uint8 path reuses its view.
    random.fill(cryptoBytes(view));
    return array;
  }

  randomUUID(): string {
    let pool = this.#uuidPool;
    if (pool === undefined) {
      pool = new Uint8Array(uuidPoolBytes);
      this.#uuidPool = pool;
    }
    if (this.#uuidOffset === uuidPoolBytes) {
      this.#random.fill(pool);
      this.#uuidOffset = 0;
    }
    const offset = this.#uuidOffset;
    this.#uuidOffset += 16;
    // Use the table directly: no per-UUID byte array, map, join or hex conversion.
    return uuidHex[pool[offset]!]! + uuidHex[pool[offset + 1]!]!
      + uuidHex[pool[offset + 2]!]! + uuidHex[pool[offset + 3]!]! + "-"
      + uuidHex[pool[offset + 4]!]! + uuidHex[pool[offset + 5]!]! + "-"
      + uuidHex[(pool[offset + 6]! & 0x0f) | 0x40]! + uuidHex[pool[offset + 7]!]! + "-"
      + uuidHex[(pool[offset + 8]! & 0x3f) | 0x80]! + uuidHex[pool[offset + 9]!]! + "-"
      + uuidHex[pool[offset + 10]!]! + uuidHex[pool[offset + 11]!]!
      + uuidHex[pool[offset + 12]!]! + uuidHex[pool[offset + 13]!]!
      + uuidHex[pool[offset + 14]!]! + uuidHex[pool[offset + 15]!]!;
  }
}
