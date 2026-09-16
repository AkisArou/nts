// Linux. libnotify over D-Bus, reached through a C shim.
//
// The tap callback arrives on the GLib main loop's thread. Whether that is the
// runtime's thread depends on the host: a GTK app drives the same loop, so it is
// a direct call; a headless build would make it foreign.
//
// **The text does not cross into C**, and that is a gap rather than a design.
// `schedule_at` would take `const char *` for the title, a generated binding
// types that `ConstPtr<c_char>`, and a JavaScript string is not one -- there is
// nothing in this compiler that marshals it yet. So C gets an integer handle and
// the text stays here, which is what `native/linux/scheduler.h` says at length.
import { schedule_at, cancel_by_id, set_tap_handler } from "c:notifications";
import type { c_double, c_int32 } from "c:types";
import type { Notification, Scheduler, TapHandler } from "./index.ts";

/** The text C never sees, keyed by the handle it does. */
const pending = new Map<number, Notification>();
let nextHandle = 1;
let onTapped: TapHandler | null = null;

function tapped(handle: c_int32): void {
  const notification = pending.get(handle as unknown as number);
  if (notification !== undefined && onTapped !== null) {
    onTapped(notification.id);
  }
}

class LinuxScheduler implements Scheduler {
  schedule(notification: Notification): void {
    const handle = nextHandle;
    nextHandle = nextHandle + 1;
    pending.set(handle, notification);
    schedule_at(handle as unknown as c_int32, notification.delay as c_double);
  }

  cancel(id: string): void {
    for (const [handle, notification] of pending) {
      if (notification.id === id) {
        cancel_by_id(handle as unknown as c_int32);
        pending.delete(handle);
        return;
      }
    }
  }

  onTap(handler: TapHandler): void {
    onTapped = handler;
    set_tap_handler(tapped);
  }
}

export function scheduler(): Scheduler {
  return new LinuxScheduler();
}
