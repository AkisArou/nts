// A window, a button, and a TypeScript closure as the button's action, inside
// `[NSApp run]`. Run on the lane's Mac, in its GUI session.
//
// An NSTimer, which is Cocoa's own, presses the button twice through
// `performClick:` and then stops the application. The action is a closure
// that counts presses and starts a promise job and a `setTimeout`. Both must
// run while AppKit's loop is running, which is what the CoreFoundation host is
// for: the job at the checkpoint after the callback, and the timeout from
// libuv's timer, which the host keeps on the run loop.
//
// The control (`WINDOW_CONTROL=detached`) takes libuv's sources off the run
// loop. The presses and the stop still happen, since Cocoa drives them, but no
// timeout may fire before the application has stopped.
import { NSApplication, NSButton, NSEvent, NSWindow, Timer, type CGPoint, type CGRect } from "objc:AppKit";
import { NtsWindowController } from "objc:Controller";
import { actionImplementation, nested_while_readable, report, timerImplementation, window_control } from "c:support";
import { class_addMethod, objc_allocateClassPair, objc_getClass, objc_registerClassPair, sel_registerName } from "objc:runtime";
import { local } from "c:memory";
import type { Ptr, c_size_t } from "c:types";

let presses = 0;
let ticks = 0;

// Logs `line` from a promise job: the `await` suspends, and what follows it
// runs as a microtask.
async function afterAJob(line: string): Promise<void> {
  await 0;
  report(line);
}

function setRect(r: Ptr<CGRect>, x: number, y: number, width: number, height: number): void {
  r.origin.x = x;
  r.origin.y = y;
  r.size.width = width;
  r.size.height = height;
}

function main(): void {
  window_control();
  const app = NSApplication.shared;
  app.setActivationPolicy(NSApplication.ActivationPolicy.regular);

  const frame = local<CGRect>();
  setRect(frame, 200, 200, 320, 200);
  const window = new NSWindow({
    contentRect: frame,
    styleMask: NSWindow.StyleMask.titled | NSWindow.StyleMask.closable,
    backing: NSWindow.BackingStoreType.buffered,
    defer: false,
  });
  window.title = "nts";
  const buttonFrame = local<CGRect>();
  setRect(buttonFrame, 110, 80, 100, 32);
  const button = new NSButton({ frame: buttonFrame });
  button.title = "Press";
  // `contentView` is `nullable` in NSWindow.h.
  const content = window.contentView;
  if (content !== null) {
    content.addSubview(button);
  }

  // The controller is defined at run time, which `class ... extends NSObject`
  // will do once subclassing lands.
  const root = objc_getClass("NSObject");
  const cls = root === null ? null : objc_allocateClassPair(root, "NtsWindowController", 0n as c_size_t);
  if (cls === null) {
    report("no class");
    return;
  }
  const pressed = actionImplementation((self, sender) => {
    presses++;
    const press = presses;
    report(`pressed ${press}`);
    void afterAJob(`micro ${press}`);
    setTimeout(() => report(`timeout ${press}`), 0);
    if (press === 1) {
      nested_while_readable();
    }
  });
  const tick = timerImplementation((self, timer) => {
    ticks++;
    if (ticks <= 2) {
      button.performClick(null);
      return;
    }
    timer.invalidate();
    report("stopped");
    app.stop(null);
    // `stop:` is seen when the loop next finishes an event, so one is posted.
    const wake = NSEvent.otherEvent({
      with: NSEvent.EventType.applicationDefined,
      location: local<CGPoint>(),
      modifierFlags: 0,
      timestamp: 0,
      windowNumber: 0,
      context: null,
      subtype: 0,
      data1: 0,
      data2: 0,
    });
    if (wake !== null) {
      app.postEvent(wake, { atStart: true });
    }
  });
  class_addMethod(cls, sel_registerName("pressed:"), pressed, "v@:@");
  class_addMethod(cls, sel_registerName("tick:"), tick, "v@:@");
  objc_registerClassPair(cls);

  const controller = new NtsWindowController();
  button.target = controller;
  button.action = sel_registerName("pressed:");
  window.makeKeyAndOrderFront(null);
  const shown = window.frame;
  const pressable = button.frame;
  const width = pressable.size.width;
  const height = button.frame.size.height;
  report(`window ${shown.size.width} button ${width}x${height}`);

  Timer.scheduledTimer({ timeInterval: 0.05, target: controller, selector: sel_registerName("tick:"), userInfo: null, repeats: true });
  app.run();
  report("done");
}

main();
