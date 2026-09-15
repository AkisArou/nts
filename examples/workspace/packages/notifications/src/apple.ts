// iOS and macOS share this file: the same C shim, two targets, two hosts.
//
// The real API is `UNUserNotificationCenter`, which is Objective-C. This
// compiler binds C headers, so `native/apple/scheduler.h` is a C surface that
// something else has to bridge. The fixture records that as a gap rather than
// pretending a C header is the platform API.
import { schedule_at, cancel_by_id, set_tap_handler } from "c:notifications";
import type { c_double, c_int } from "c:types";
import type { Notification, Scheduler, TapHandler } from "./index.ts";

class AppleScheduler implements Scheduler {
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
  return new AppleScheduler();
}
