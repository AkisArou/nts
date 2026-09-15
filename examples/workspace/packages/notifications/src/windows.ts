// Windows: WinRT.
//
// `winrt:` names a `.winmd` namespace. Pretend-supported, and the nearest of
// the three to something real here: `.winmd` is ECMA-335 metadata, so the
// reader in `compiler/jvm-emitter` is the shape that transfers. What does not
// transfer is the call -- WinRT is COM underneath, so this is a vtable and an
// `HSTRING`, not a JNI-style bridge.
import { Scheduler as Native } from "winrt:Example.Notifications";
import type { Notification, Scheduler, TapHandler } from "./index.ts";

class WindowsScheduler implements Scheduler {
  private readonly native = new Native();

  schedule(notification: Notification): void {
    this.native.Schedule(notification.id, notification.title, notification.body, notification.delay);
  }

  cancel(id: string): void {
    this.native.Cancel(id);
  }

  onTap(handler: TapHandler): void {
    this.native.SetTapHandler(handler);
  }
}

export function scheduler(): Scheduler {
  return new WindowsScheduler();
}
