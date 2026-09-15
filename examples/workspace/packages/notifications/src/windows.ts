// Windows. The toast API, reached through a C shim.
//
// The real surface is WinRT (`Windows.UI.Notifications`), which is neither C
// nor Java -- so this is the platform where "bind the native API" has no answer
// in this compiler at all. The C shim is a stand-in and the fixture says so.
import { schedule_at, cancel_by_id, set_tap_handler } from "c:notifications";
import type { c_double } from "c:types";
import type { Notification, Scheduler, TapHandler } from "./index.ts";

class WindowsScheduler implements Scheduler {
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
  return new WindowsScheduler();
}
