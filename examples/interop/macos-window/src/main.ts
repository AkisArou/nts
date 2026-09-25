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
  Bundle,
  NSButton,
  NSEvent,
  NSObject,
  NSWindow,
  Timer,
  type CGPoint,
  type CGRect,
  type NSNotification,
  type NSWindowDelegate,
} from "objc:AppKit";
import { nested_while_readable, report, window_control } from "c:support";
import { sel_registerName } from "objc:runtime";
import { local } from "c:memory";
import type { Ptr } from "c:types";

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

// The button's target and the window's delegate: an Objective-C class of the
// program's own, as Swift's `class Controller: NSObject, NSWindowDelegate` is.
// AppKit sends it `pressed:` when the button is pressed.
class Controller extends NSObject implements NSWindowDelegate {
  pressed(sender: NSObject): void {
    presses++;
    const press = presses;
    report(`pressed ${press}`);
    void afterAJob(`micro ${press}`);
    setTimeout(() => report(`timeout ${press}`), 0);
    if (press === 1) {
      nested_while_readable();
    }
  }

  // `NSWindowDelegate`'s `windowWillClose(_:)`, sent `windowWillClose:` when the
  // timer closes the window.
  windowWillClose(notification: NSNotification): void {
    report("closing");
  }
}

// A sheet on the window, ended as soon as it is begun, for `sheet` below.
function makeSheet(): NSWindow {
  const frame = local<CGRect>();
  setRect(frame, 0, 0, 200, 100);
  return new NSWindow({
    contentRect: frame,
    styleMask: NSWindow.StyleMask.titled,
    backing: NSWindow.BackingStoreType.buffered,
    defer: false,
  });
}

// Swift's `await window.beginSheet(sheet)`: the method taking a completion
// handler, as the promise the handler settles (`types/appkit.values.ts`).
async function sheet(window: NSWindow, panel: NSWindow): Promise<void> {
  const ended = window.beginSheet(panel);
  window.endSheet(panel, { returnCode: 1001 });
  report(`sheet ${await ended}`);
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
  // `contentView` is `nullable` in NSWindow.h: Swift's optional chaining.
  window.contentView?.addSubview(button);

  const tick = (timer: Timer): void => {
    ticks++;
    if (ticks <= 2) {
      button.performClick(null);
      return;
    }
    timer.invalidate();
    // Begun and ended here, so what awaits it runs at this callback's
    // checkpoint: after the window closes, before the loop returns.
    void sheet(window, makeSheet());
    report("stopped");
    window.close();
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
  };
  const controller = new Controller();
  button.target = controller;
  window.delegate = controller;
  button.action = sel_registerName("pressed:");
  window.makeKeyAndOrderFront(null);
  const shown = window.frame;
  const pressable = button.frame;
  const width = pressable.size.width;
  const height = button.frame.size.height;
  // `subviews` is Swift's `[NSView]`: an array copied out of the NSArray.
  const views = window.contentView?.subviews.length ?? 0;
  report(`window ${shown.size.width} button ${width}x${height} views ${views}`);
  // Which the program is: a bare executable has no bundle identifier, and an
  // application has the one its `Info.plist` gives it.
  report(`bundle ${Bundle.main.bundleIdentifier ?? "none"}`);

  // Swift's `Timer.scheduledTimer(withTimeInterval:repeats:) { timer in ... }`:
  // the closure a block the timer keeps, and calls from the run loop.
  Timer.scheduledTimer({ withTimeInterval: 0.05, repeats: true }, tick);
  app.run();
  report("done");
}

main();
