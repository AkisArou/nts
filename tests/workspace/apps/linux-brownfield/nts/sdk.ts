// Exported as C symbols, so the surface is functions rather than a class.
//
// The source names are unprefixed: `prefix: "acme"` in the config names each
// export `acme_<C name>`, so the host calls `acme_remember`. Static libraries
// apply this policy; shared-library prefix emission is pending #1005.
import { scheduler } from "@workspace/notifications";
import { store } from "@workspace/storage";

export function remember(key: string, value: string): void {
  store().set(key, value);
}

export function notify(id: string, title: string, body: string): void {
  scheduler().schedule({ id, title, body, delay: 0 });
}
