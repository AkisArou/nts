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
import {
  NSApplication,
  NSButton,
  NSEvent,
  NSObject,
  NSString,
  NSTimer,
  NSWindow,
  NtsWindowController,
  type CGPoint,
  type CGRect,
} from "objc:AppKit";
import { actionImplementation, nested_while_readable, report, timerImplementation, window_control } from "c:support";
import { class_addMethod, objc_allocateClassPair, objc_registerClassPair, sel_registerName } from "objc:runtime";
import { local } from "c:memory";
import type { Ptr, c_double, c_int16, c_long, c_size_t, c_ulong } from "c:types";

let presses = 0;
let ticks = 0;

// Logs `line` from a promise job: the `await` suspends, and what follows it
// runs as a microtask.
async function afterAJob(line: string): Promise<void> {
  await 0;
  report(line);
}

function setRect(r: Ptr<CGRect>, x: number, y: number, width: number, height: number): void {
  r.origin.x = x as c_double;
  r.origin.y = y as c_double;
  r.size.width = width as c_double;
  r.size.height = height as c_double;
}

function main(): void {
  window_control();
  const app = NSApplication.sharedApplication();
  app.setActivationPolicy(0n as c_long);

  const frame = local<CGRect>();
  setRect(frame, 200, 200, 320, 200);
  // Titled and closable, buffered, not deferred.
  const window = NSWindow.alloc().initWithContentRect(frame, 3n as c_ulong, 2n as c_ulong, false);
  window.title = NSString.stringWithUTF8String("nts");
  const buttonFrame = local<CGRect>();
  setRect(buttonFrame, 110, 80, 100, 32);
  const button = NSButton.alloc().initWithFrame(buttonFrame);
  button.title = NSString.stringWithUTF8String("Press");
  window.contentView.addSubview(button);

  const cls = objc_allocateClassPair(NSObject, "NtsWindowController", 0n as c_size_t);
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
    app.postEvent(NSEvent.otherEventWithTypeLocationModifierFlagsTimestampWindowNumberContextSubtypeData1Data2(15n as c_ulong, local<CGPoint>(), 0n as c_ulong, 0 as c_double, 0n as c_long, null,
      0 as c_int16, 0n as c_long, 0n as c_long), true);
  });
  class_addMethod(cls, sel_registerName("pressed:"), pressed, "v@:@");
  class_addMethod(cls, sel_registerName("tick:"), tick, "v@:@");
  objc_registerClassPair(cls);

  const controller = NtsWindowController.new();
  button.target = controller;
  button.action = sel_registerName("pressed:");
  window.makeKeyAndOrderFront(null);
  const shown = window.frame;
  const pressable = button.frame;
  const width = pressable.size.width;
  const height = button.frame.size.height;
  report(`window ${shown.size.width} button ${width}x${height}`);

  NSTimer.scheduledTimerWithTimeIntervalTargetSelectorUserInfoRepeats(0.05 as c_double, controller, sel_registerName("tick:"), null, true);
  app.run();
  report("done");
}

main();
