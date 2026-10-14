// Windows: notifications and storage. The notification half has no real binding
// story here -- see packages/notifications/native/windows/scheduler.h.
import { scheduler } from "@workspace/notifications";
import { store } from "@workspace/storage";

export function main(): void {
  scheduler().onTap((id) => { store().set("lastTap", id); });
}
