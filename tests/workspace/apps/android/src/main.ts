// Android: notifications (Java half), biometrics (android+ios only), storage.
import { scheduler } from "@workspace/notifications";
import { prompt } from "@workspace/biometrics";
import { store } from "@workspace/storage";

export function main(): void {
  store().set("started", "1");
  scheduler().onTap((id) => { store().set("lastTap", id); });
  void prompt().authenticate("unlock");
}
