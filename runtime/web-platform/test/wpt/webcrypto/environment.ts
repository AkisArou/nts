// Host setup for the unedited WebCryptoAPI corpus. Cryptographic operations use
// the package's canonical surface over its native primitive test provider.
import assert from "node:assert/strict";
import { btoa } from "node:buffer";
import { createHostNodeWebPlatform } from "../../../host/node-runtime.ts";
import {
  Crypto, CryptoKey, DOMException, SubtleCrypto, TextDecoder, TextEncoder,
} from "../../../src/index.ts";
import { NodeCryptoProvider } from "../../node-crypto-provider.ts";
import type { WptEnvironment, WptFixtureContext } from "../runner.ts";

export function createWebCryptoWptEnvironment(
  reportError: (error: unknown) => void,
  context: WptFixtureContext,
): WptEnvironment {
  const runtime = createHostNodeWebPlatform({ crypto: new NodeCryptoProvider() }, {}, reportError);
  const crypto = runtime.crypto;
  assert.ok(crypto instanceof Crypto, "WebCrypto WPT must receive the package's Crypto object");
  return {
    exposeSelf: true,
    globals: {
      Crypto, CryptoKey, DOMException, SubtleCrypto, TextDecoder, TextEncoder, crypto,
      // The genuine implementation-realm constructors preserve byte inputs and
      // returned buffer identities. Literal/global realm requirements remain
      // explicit manifest limitations, as in the shared Streams WPT driver.
      Object, Function, Promise, ArrayBuffer, SharedArrayBuffer, DataView,
      Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array,
      Int32Array, Uint32Array, Float16Array, Float32Array, Float64Array,
      BigInt64Array, BigUint64Array,
      location: context.url,
      gc: globalThis.gc,
      // Upstream util/helpers.js uses this native host utility to prepare JWK
      // fixture bytes. It is not a package API or a cryptographic implementation.
      btoa,
      // ECDSA's original vector helper copies plain records before registration.
      // Do not expose host cloning to the package CryptoKey serialization tests.
      ...(context.fixture.path === "WebCryptoAPI/sign_verify/ecdsa.https.any.js"
        ? { structuredClone: globalThis.structuredClone } : {}),
    },
    close: () => runtime.close(),
  };
}
