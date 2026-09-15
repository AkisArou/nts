// iOS: the same three packages as Android, through entirely different native
// halves -- Java there, a C shim here.
import { scheduler } from "@workspace/notifications";
import { prompt } from "@workspace/biometrics";
import { store } from "@workspace/storage";

export function main(): void {
  store().set("started", "1");
  scheduler().onTap((id) => { store().set("lastTap", id); });
  void prompt().authenticate("unlock");
}
