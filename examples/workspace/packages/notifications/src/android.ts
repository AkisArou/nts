// Android. TypeScript that names Java, and is only emitted for android-*.
//
// Two directions in one file, which is why the config declares them separately:
//   - `schedule` and `cancel` are TypeScript calling Java;
//   - `onTap` registers a handler that **Java calls back into**, from a Looper
//     thread. That is a foreign thread to the runtime, so it is an inbox post
//     rather than a direct call -- see `NtsInbox`.
import { Scheduler as Native } from "java:com.example.notifications";
import type { Notification, Scheduler, TapHandler } from "./index.ts";

class AndroidScheduler implements Scheduler {
  private readonly native = new Native();

  schedule(notification: Notification): void {
    this.native.schedule(notification.id, notification.title, notification.body, notification.delay);
  }

  cancel(id: string): void {
    this.native.cancel(id);
  }

  onTap(handler: TapHandler): void {
    // Crossing back. The Java side holds this and posts on tap.
    this.native.setTapHandler(handler);
  }
}

export function scheduler(): Scheduler {
  return new AndroidScheduler();
}
