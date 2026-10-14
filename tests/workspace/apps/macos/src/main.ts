// macOS: notifications and storage. No biometrics -- `biometrics` declares
// android and iOS only, and macOS is not in that set even though it shares a
// backend and most of a native surface with iOS.
import { scheduler } from "@workspace/notifications";
import { store } from "@workspace/storage";

export function main(): void {
  scheduler().onTap((id) => { store().set("lastTap", id); });
}
