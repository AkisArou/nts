// Linux: notifications, storage, telemetry. Deliberately not biometrics.
import { scheduler } from "@workspace/notifications";
import { store } from "@workspace/storage";
import { begin, elapsed } from "@workspace/telemetry";

export function main(): void {
  const span = begin("startup");
  scheduler().onTap((id) => { store().set("lastTap", id); });
  store().set("startupMs", String(elapsed(span)));
}
