import { digest } from "@workspace/crypto-core";
import { store } from "@workspace/storage";

export function remember(key: string, value: string): number {
  store().set(key, value);
  return digest(new TextEncoder().encode(value));
}

export { digest };
