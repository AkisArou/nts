import { scheduler } from "@workspace/notifications";
import { store } from "@workspace/storage";

export function remember(key: string, value: string): void {
  store().set(key, value);
}

export function notify(id: string, title: string, body: string): void {
  scheduler().schedule({ id, title, body, delay: 0 });
}
