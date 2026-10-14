// iOS and macOS: one Swift type, two targets, two hosts.
//
// The specifier is `swift:` rather than `c:`, which is the pretend part -- today
// this compiler binds C headers and class files. The realistic route is that
// `swiftc -emit-objc-header` produces a header we already read, so `swift:` is
// sugar over a generated C surface rather than a second binding mechanism.
import { Scheduler as Native } from "swift:Notifications";
import type { Notification, Scheduler, TapHandler } from "./index.ts";

class AppleScheduler implements Scheduler {
  private readonly native = new Native();

  schedule(notification: Notification): void {
    this.native.schedule(notification.id, notification.title, notification.body, notification.delay);
  }

  cancel(id: string): void {
    this.native.cancel(id);
  }

  onTap(handler: TapHandler): void {
    // Delivered on the main queue, which under `host.ios` is the runtime's own
    // thread -- so this is a direct call. Android's equivalent is not, and that
    // is a property of the host rather than of the language.
    this.native.setTapHandler(handler);
  }
}

export function scheduler(): Scheduler {
  return new AppleScheduler();
}
