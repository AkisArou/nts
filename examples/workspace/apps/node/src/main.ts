// A Node addon: no notifications, no host, no UI. Just the portable C package
// and storage, exported through Node-API.
import { digest } from "@workspace/crypto-core";
import { store } from "@workspace/storage";

export function putRecord(key: string, value: string): number {
  store().set(key, value);
  return digest(new TextEncoder().encode(value));
}

export { digest };
