/**
 * @nts/sdk/security — secrets and proving the user is present.
 *
 * Standard parts (use directly): Web Crypto (`crypto.subtle`) for
 * cryptography, WebAuthn (`navigator.credentials`) for passkeys.
 * SDK parts: the two with no standard — OS secret storage
 * (Keychain/Keystore/Credential Manager/libsecret) and a local
 * biometric/device-credential check.
 */
import type { Availability, SignalOptions } from "./core.d.ts";

/** Re-exported so `@nts/sdk/security` is self-describing in the API reference. */
export type Crypto = globalThis.Crypto;
export type SubtleCrypto = globalThis.SubtleCrypto;
export type CredentialsContainer = globalThis.CredentialsContainer;
export type PublicKeyCredential = globalThis.PublicKeyCredential;

export interface SecureAccessOptions extends SignalOptions {
  /**
   * Require fresh biometric/device-credential auth for this access, with
   * this user-visible reason. Where neither exists, rejects `unavailable`
   * rather than silently skipping the check.
   */
  readonly requireAuthentication?: string;
  readonly unlockedOnly?: boolean;
}

/** Small strings/bytes only (OS limits are a few KB). Unsupported in a
 * browser: `availability()` says so — secrets never downgrade to storage. */
export interface SecureStorage {
  availability(): Promise<Availability>;
  get(key: string, options?: SecureAccessOptions): Promise<string | undefined>;
  set(key: string, value: string, options?: SecureAccessOptions): Promise<void>;
  getBytes(key: string, options?: SecureAccessOptions): Promise<Uint8Array | undefined>;
  setBytes(key: string, value: Uint8Array, options?: SecureAccessOptions): Promise<void>;
  remove(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
}

export declare const secureStorage: SecureStorage;

export type BiometricKind = "face" | "fingerprint" | "iris" | "unknown";

export type AuthenticationResult =
  | { readonly status: "authenticated"; readonly kind: BiometricKind | "device-credential" }
  | { readonly status: "cancelled" }
  | { readonly status: "unavailable"; readonly reason: string };

export interface Biometrics {
  /** Enrolled biometric kinds; empty when none/unavailable. */
  available(): Promise<readonly BiometricKind[]>;
  /**
   * Asks the OS to verify the user, showing `reason`. Local only: the
   * result proves presence on this device, it is not a credential —
   * for server-verifiable auth use WebAuthn passkeys.
   */
  authenticate(reason: string, options?: SignalOptions & {
    /** Allow PIN/password fallback. Default true. */
    readonly allowDeviceCredential?: boolean;
  }): Promise<AuthenticationResult>;
}

export declare const biometrics: Biometrics;
