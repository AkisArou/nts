// The published surface. Everything here is reachable from Java; nothing else is.
import { scheduler } from "@workspace/notifications";
import { store } from "@workspace/storage";

export class Sdk {
  remember(key: string, value: string): void {
    store().set(key, value);
  }

  notify(id: string, title: string, body: string): void {
    scheduler().schedule({ id, title, body, delay: 0 });
  }
}
