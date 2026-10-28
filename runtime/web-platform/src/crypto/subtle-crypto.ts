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
      // Exactly one whole-input primitive call, before script can change data.
      // Native bindings report failures as values; they cannot throw into TS.
      const digest = provider.digest(normalized.name, bytes);
      if ("failure" in digest) {
        const error = new DOMException("The digest operation failed", "OperationError");
        scheduler.enqueue(() => pending.reject(error));
      } else {
        // The provider transfers a fresh, full-buffer Uint8Array to this layer.
        const result = digest.buffer as ArrayBuffer;
        scheduler.enqueue(() => pending.resolve(result));
      }
      return pending.promise;
    } catch (error) {
      return Promise.reject(error);
    }
  }
}
