import { DOMException } from "../core/errors.ts";
import { requireArguments } from "../core/webidl.ts";
import type { CryptoDigestProvider } from "../provider/crypto.ts";
import type { Scheduler } from "../provider/primitives.ts";
import { normalizeAlgorithm, toAlgorithmIdentifier } from "./algorithms.ts";
import { cryptoBytes, toCryptoBufferSource } from "./buffer-source.ts";

/** The first increment implements digest; subsequent algorithm PRs add key operations. */
export class SubtleCrypto {
  readonly #provider: CryptoDigestProvider;
  readonly #scheduler: Scheduler;

  /** Provider construction; runtime/global exposure is a separate integration change. */
  constructor(provider: CryptoDigestProvider, scheduler: Scheduler) {
    this.#provider = provider;
    this.#scheduler = scheduler;
  }

  /** Web Cryptography §§14.3.5 and 32, https://w3c.github.io/webcrypto/#SubtleCrypto-method-digest. */
  digest(algorithm: unknown, data: unknown): Promise<ArrayBuffer> {
    // Promise-returning IDL operations reject even for an invalid receiver or
    // missing argument. Keep conversion errors out of the native-error mapping.
    try {
      const provider = this.#provider;
      const scheduler = this.#scheduler;
      requireArguments(arguments, 2, "SubtleCrypto.digest");
      const identifier = toAlgorithmIdentifier(algorithm);
      const source = toCryptoBufferSource(data);
      const normalized = normalizeAlgorithm(identifier, "digest");
      const bytes = cryptoBytes(source);
      const pending = Promise.withResolvers<ArrayBuffer>();
      try {
        // Exactly one whole-input primitive call, before script can change data.
        // The provider transfers a fresh, full-buffer Uint8Array to this layer.
        const digest = provider.digest(normalized.name, bytes);
        const result = digest.buffer as ArrayBuffer;
        scheduler.enqueue(() => pending.resolve(result));
      } catch {
        const error = new DOMException("The digest operation failed", "OperationError");
        scheduler.enqueue(() => pending.reject(error));
      }
      return pending.promise;
    } catch (error) {
      return Promise.reject(error);
    }
  }
}

// Web IDL interface descriptors; see core/interface-tag.ts.
for (const key of Object.getOwnPropertyNames(SubtleCrypto.prototype)) {
  if (key === "constructor") continue;
  const descriptor = Object.getOwnPropertyDescriptor(SubtleCrypto.prototype, key);
  if (descriptor === undefined || descriptor.enumerable) continue;
  descriptor.enumerable = true;
  Object.defineProperty(SubtleCrypto.prototype, key, descriptor);
}
Object.defineProperty(SubtleCrypto.prototype, Symbol.toStringTag, {
  value: "SubtleCrypto",
  writable: false,
  enumerable: false,
  configurable: true,
});
Object.defineProperty(SubtleCrypto, "length", { value: 0 });
