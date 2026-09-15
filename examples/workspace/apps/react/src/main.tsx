// One entry, four targets. No React dependency is declared -- this names a
// planned feature, and the file is here to be the thing the four targets share.
import { scheduler } from "@workspace/notifications";
import { store } from "@workspace/storage";

export function App(): unknown {
  scheduler().onTap((id) => { store().set("lastTap", id); });
  return null;
}
