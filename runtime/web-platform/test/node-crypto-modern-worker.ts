// Test-only bridge to the pinned native jobs used by Node 24.20's own crypto
// implementation. No WebCrypto method, hash, sponge or MAC algorithm is written
// here. API layouts are from node/v24.20.0/lib/internal/crypto/{hash,mac}.js.
import { createRequire } from "node:module";
import { timingSafeEqual } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { workerData } from "node:worker_threads";
import type { MessagePort } from "node:worker_threads";
import type { NativeModernCryptoCapability, NativeModernCryptoRequest } from "./node-crypto-modern-jobs.ts";

interface NativeJob { run(): readonly [unknown, ArrayBuffer | boolean | undefined]; }
interface NativeCryptoBinding {
  readonly Argon2Job: unknown;
  readonly RsaKeyPairGenJob: unknown;
  readonly EcKeyPairGenJob: unknown;
  readonly NidKeyPairGenJob: unknown;
  readonly SignJob: unknown;
  readonly KEMEncapsulateJob: unknown;
  readonly KEMDecapsulateJob: unknown;
  readonly EVP_PKEY_ED25519: number | undefined;
  readonly EVP_PKEY_ED448: number | undefined;
  readonly EVP_PKEY_X25519: number | undefined;
  readonly EVP_PKEY_X448: number | undefined;
  readonly EVP_PKEY_ML_DSA_44: number | undefined;
  readonly EVP_PKEY_ML_DSA_65: number | undefined;
  readonly EVP_PKEY_ML_DSA_87: number | undefined;
  readonly EVP_PKEY_ML_KEM_512: number | undefined;
  readonly EVP_PKEY_ML_KEM_768: number | undefined;
  readonly EVP_PKEY_ML_KEM_1024: number | undefined;
  readonly kCryptoJobSync: number;
  readonly kSignJobModeSign: number;
  readonly CShakeJob: new (mode: number, name: string, data: Uint8Array, functionName: Uint8Array, customization: Uint8Array, outputLength: number) => NativeJob;
  readonly KmacJob: new (mode: number, signMode: number, key: object, name: string, customization: Uint8Array, keyLength: number, outputLength: number, data: Uint8Array, signature: undefined) => NativeJob;
}

const context = workerData as { port: MessagePort; signal: Int32Array };
const require = createRequire(import.meta.url);
let binding: NativeCryptoBinding | undefined;
let prepareSecretKey: ((key: KeyObject) => object) | undefined;
try {
  const testBinding = require("internal/test/binding") as { internalBinding(name: string): NativeCryptoBinding };
  binding = testBinding.internalBinding("crypto");
  prepareSecretKey = (require("internal/crypto/keys") as { prepareSecretKey(key: KeyObject): object }).prepareSecretKey;
} catch {
  // Every queued request still receives a failure value if this Node build lacks
  // the pinned native seam. Startup failure must not strand the caller's wait.
}

/** Build metadata only: never construct or run a native cryptographic job. */
function hasNativeCapability(capability: NativeModernCryptoCapability): boolean {
  if (binding === undefined) return false;
  switch (capability) {
    case "cshake": return typeof binding.CShakeJob === "function";
    case "kmac": return typeof binding.KmacJob === "function";
    case "argon2": return typeof binding.Argon2Job === "function";
    case "rsa": return typeof binding.RsaKeyPairGenJob === "function";
    case "ec": return typeof binding.EcKeyPairGenJob === "function";
  }
  if (typeof binding.NidKeyPairGenJob !== "function") return false;
  switch (capability) {
    case "Ed25519": return binding.EVP_PKEY_ED25519 !== undefined;
    case "Ed448": return binding.EVP_PKEY_ED448 !== undefined;
    case "X25519": return binding.EVP_PKEY_X25519 !== undefined;
    case "X448": return binding.EVP_PKEY_X448 !== undefined;
    case "ML-DSA-44": return binding.EVP_PKEY_ML_DSA_44 !== undefined && typeof binding.SignJob === "function";
    case "ML-DSA-65": return binding.EVP_PKEY_ML_DSA_65 !== undefined && typeof binding.SignJob === "function";
    case "ML-DSA-87": return binding.EVP_PKEY_ML_DSA_87 !== undefined && typeof binding.SignJob === "function";
    case "ML-KEM-512": return binding.EVP_PKEY_ML_KEM_512 !== undefined
      && typeof binding.KEMEncapsulateJob === "function" && typeof binding.KEMDecapsulateJob === "function";
    case "ML-KEM-768": return binding.EVP_PKEY_ML_KEM_768 !== undefined
      && typeof binding.KEMEncapsulateJob === "function" && typeof binding.KEMDecapsulateJob === "function";
    case "ML-KEM-1024": return binding.EVP_PKEY_ML_KEM_1024 !== undefined
      && typeof binding.KEMEncapsulateJob === "function" && typeof binding.KEMDecapsulateJob === "function";
  }
}

context.port.on("message", (request: NativeModernCryptoRequest) => {
  let response: ArrayBuffer | boolean | { failure: "operation" } = { failure: "operation" };
  try {
    if (request.kind === "supports") {
      response = hasNativeCapability(request.capability);
    } else if (binding !== undefined && prepareSecretKey !== undefined) {
      const p = request.parameters;
      let job: NativeJob;
      if (p.name === "cSHAKE128" || p.name === "cSHAKE256") {
        // cSHAKE's prefix is independent of requested output size. Request whole
        // octets because Node truncates non-octet outputs from the high end; the
        // adapter encodes §2.1's remaining low bits after this native call.
        if (p.outputLength > 0xfffffff8) throw new RangeError("Native rounded cSHAKE length exceeds uint32");
        job = new binding.CShakeJob(binding.kCryptoJobSync, p.name, request.data,
          p.functionName, p.customization, Math.ceil(p.outputLength / 8) * 8);
      } else if ("keyLength" in p) {
        if (request.key === undefined || p.outputLength % 8 !== 0) throw new TypeError("Invalid native KMAC request");
        job = new binding.KmacJob(binding.kCryptoJobSync, binding.kSignJobModeSign,
          prepareSecretKey(request.key), p.name, p.customization, p.keyLength, p.outputLength, request.data, undefined);
      } else {
        throw new TypeError("Unknown native modern algorithm");
      }
      const [error, result] = job.run();
      if (error === undefined && result instanceof ArrayBuffer) {
        const bits = new Uint8Array(result);
        if (p.outputLength % 8 !== 0) bits[bits.length - 1]! &= (1 << (p.outputLength % 8)) - 1;
        // KmacJob's verify mode rejects all empty MACs; native timingSafeEqual
        // supplies the specified constant-time comparison, including zero bits.
        response = request.signature === undefined ? result
          : bits.byteLength === request.signature.byteLength && timingSafeEqual(bits, request.signature);
      }
    }
  } catch {
    response = { failure: "operation" };
  }
  context.port.postMessage(response, response instanceof ArrayBuffer ? [response] : []);
  Atomics.store(context.signal, 0, 1);
  Atomics.notify(context.signal, 0);
});
