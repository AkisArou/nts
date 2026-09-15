// Linux. libnotify over D-Bus, reached through a C shim.
//
// The tap callback arrives on the GLib main loop's thread. Whether that is the
// runtime's thread depends on the host: `host.gtk` drives the same loop, so it
// is a direct call; a headless build would make it foreign. The direction is
// declared either way, because the config cannot see which host an app chose.
import { schedule_at, cancel_by_id, set_tap_handler } from "c:notifications";
import type { c_double } from "c:types";
import type { Notification, Scheduler, TapHandler } from "./index.ts";

class LinuxScheduler implements Scheduler {
  schedule(notification: Notification): void {
    schedule_at(notification.id, notification.title, notification.body, notification.delay as c_double);
  }

  cancel(id: string): void {
    cancel_by_id(id);
  }

  onTap(handler: TapHandler): void {
    set_tap_handler(handler);
  }
}

export function scheduler(): Scheduler {
  return new LinuxScheduler();
}
