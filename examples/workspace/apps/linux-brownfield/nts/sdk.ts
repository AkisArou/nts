// Exported as C symbols, so the surface is functions rather than a class.
import { scheduler } from "@workspace/notifications";
import { store } from "@workspace/storage";

export function acme_remember(key: string, value: string): void {
  store().set(key, value);
}

export function acme_notify(id: string, title: string, body: string): void {
  scheduler().schedule({ id, title, body, delay: 0 });
}
