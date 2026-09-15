// Exported as C symbols, so the surface is functions rather than a class.
//
// The names are unprefixed: `prefix: "acme_"` in the config puts `acme_` on
// every exported symbol, so `src/main.cpp` still links `acme_remember`. They
// were spelled `acme_remember` here because there was no field to say it in,
// which is a namespace encoded in an identifier -- exactly what `javaPackage`
// and `moduleName` exist to avoid on the other library kinds.
import { scheduler } from "@workspace/notifications";
import { store } from "@workspace/storage";

export function remember(key: string, value: string): void {
  store().set(key, value);
}

export function notify(id: string, title: string, body: string): void {
  scheduler().schedule({ id, title, body, delay: 0 });
}

// Imported by the app's own tests, and not part of the published ABI. It has to
// be `export`ed for a sibling module to reach it, which is why narrowing lives
// in the config rather than in the keyword.
export function dumpState(): string {
  const opened = store().get("opened");
  return opened === null ? "closed" : "opened=" + opened;
}
