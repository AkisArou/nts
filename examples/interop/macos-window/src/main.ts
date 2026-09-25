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
  NSAnimationContext,
  NSApplication,
  NSGraphicsContext,
  Bundle,
  NSButton,
  NSEvent,
  NSObject,
  NSView,
  NSWindow,
  Timer,
  type CGPoint,
  type CGRect,
  type CGSize,
  type NSNotification,
  type NSWindowDelegate,
} from "objc:AppKit";
import {
  nested_while_readable,
  report,
  send_draw_rect,
  send_mouse_down,
  view_alignment_rect,
  view_intrinsic_size,
  view_is_flipped,
  window_control,
} from "c:support";
import { sel_registerName } from "objc:runtime";
import { local } from "c:memory";
import type { ByValue, Ptr, c_double } from "c:types";

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

// Swift's `override func draw(_ dirtyRect: NSRect)` and `hitTest(_:)`: a view
// of the program's own, whose overrides answer the selectors the methods they
// override have, `drawRect:` and `hitTest:` -- not the ones Swift's names
// would make. The runtime passes each a record by value: a rectangle in
// memory, and a point in two registers.
let drawnWidth = 0;
let drawnHeight = 0;
let hitX = 0;
let mouseData = 0;

class Canvas extends NSView {
  // Swift's `override var isFlipped: Bool { true }`: the getter of the
  // property it overrides, `isFlipped`, which AppKit sends to lay out.
  get isFlipped(): boolean {
    return true;
  }

  draw(dirtyRect: ByValue<CGRect>): void {
    drawnWidth = dirtyRect.size.width;
    drawnHeight = dirtyRect.size.height;
    // Swift's `NSGraphicsContext.current?.cgContext`: Core Graphics, in the
    // context AppKit drew this view into, where there is one.
    const context = NSGraphicsContext.current?.cgContext;
    if (context !== undefined) {
      context.setFillColor({ red: 1, green: 0, blue: 0, alpha: 1 });
      context.fill({ size: { width: 10, height: 10 } });
    }
    // `NSView`'s own, which draws nothing: a record by value through a super
    // message.
    super.draw(dirtyRect);
  }

  // `[super hitTest:]` answers this view for a point inside it: the message
  // sent past this override, from `NSView`'s implementation.
  hitTest(point: ByValue<CGPoint>): NSView | null {
    hitX = point.x;
    return super.hitTest(point);
  }

  // Swift's `override var intrinsicContentSize: NSSize`: a record by value
  // back to the runtime -- 16 bytes, in registers.
  get intrinsicContentSize(): ByValue<CGSize> {
    const size = local<CGSize>();
    size.width = 64;
    size.height = 48;
    return size;
  }

  // Swift's `override func alignmentRect(forFrame:)`: labels in and a
  // rectangle out, 32 bytes that x86_64 returns in memory. What `super`
  // answers, moved right by 5.
  alignmentRect(labels: { forFrame: ByValue<CGRect> }): ByValue<CGRect> {
    const rect = local<CGRect>();
    const aligned = super.alignmentRect(labels);
    setRect(rect, aligned.origin.x + 5, aligned.origin.y, aligned.size.width, aligned.size.height);
    return rect;
  }

  // Swift's `override func mouseDown(with event: NSEvent)`: a labelled
  // selector, `mouseDown:`, whose IMP takes the event as its one argument and
  // hands the method the labels object it declares.
  mouseDown(labels: { with: NSEvent }): void {
    mouseData = labels.with.data1;
  }

  // `super.centerScanRect(_:)`: a rectangle in and one out, 32 bytes that
  // x86_64 returns in memory -- so the answer comes through
  // `objc_msgSendSuper_stret`, and arm64's through `objc_msgSendSuper`.
  scannedWidth(width: number): number {
    return super.centerScanRect({ origin: { x: 0.25, y: 0 }, size: { width, height: 30 } }).size.width;
  }
}

// A sheet on the window, ended as soon as it is begun, for `sheet` below.
function makeSheet(): NSWindow {
  return new NSWindow({
    contentRect: { size: { width: 200, height: 100 } },
    styleMask: NSWindow.StyleMask.titled,
    backing: NSWindow.BackingStoreType.buffered,
    defer: false,
  });
}

// Swift's `await NSAnimationContext.runAnimationGroup { context in ... }`: a
// class method taking a completion handler is a static returning a promise.
// What follows it runs once AppKit has called the handler, from the run
// loop, so the presses start from there and not on a clock racing it.
async function animated(then: () => void): Promise<void> {
  let duration = -1;
  await NSAnimationContext.runAnimationGroup((context) => {
    context.duration = 0;
    duration = context.duration;
  });
  report(`animated ${duration}`);
  then();
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

  // Swift's `NSRect(x: 200, y: 200, width: 320, height: 200)`: the record's
  // fields, written where the message takes it, in the caller's frame.
  const window = new NSWindow({
    contentRect: { origin: { x: 200, y: 200 }, size: { width: 320, height: 200 } },
    styleMask: NSWindow.StyleMask.titled | NSWindow.StyleMask.closable,
    backing: NSWindow.BackingStoreType.buffered,
    defer: false,
  });
  window.title = "nts";
  const button = new NSButton({ frame: { origin: { x: 110, y: 80 }, size: { width: 100, height: 32 } } });
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
      location: { x: 0, y: 0 },
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
  const canvas = new Canvas({ frame: { size: { width: 40, height: 30 } } });
  window.contentView?.addSubview(canvas);
  // AppKit asks each subview, so the override is called now, synchronously.
  window.contentView?.hitTest({ x: 10, y: 12 });
  const content = window.contentView;
  const found = content === null ? null : content.hitTest({ x: 10, y: 12 });
  report(`hit ${hitX} ${found === canvas ? "the canvas" : "something else"}`);
  // `drawRect:` sent with a rectangle whose size is known: AppKit's own
  // draws pass what it chooses, which since macOS 14 may exceed the bounds.
  send_draw_rect(canvas, 1 as c_double, 2 as c_double, 40 as c_double, 30 as c_double);
  report(`drawn ${drawnWidth}x${drawnHeight}`);
  // And a plain view, which is not: the override is the canvas's alone.
  report(`flipped ${canvas.isFlipped} ${view_is_flipped(canvas)} ${content === null ? "none" : view_is_flipped(content)}`);
  // Scanned to whole pixels, through `super` and through an ordinary send,
  // which the canvas does not override: the same NSView implementation.
  const plain = { origin: { x: 0.25, y: 0 }, size: { width: 40.6, height: 30 } };
  report(`scanned ${canvas.scannedWidth(40.6)} ${canvas.centerScanRect(plain).size.width}`);
  const click = NSEvent.otherEvent({
    with: NSEvent.EventType.applicationDefined,
    location: { x: 0, y: 0 },
    modifierFlags: 0,
    timestamp: 0,
    windowNumber: 0,
    context: null,
    subtype: 0,
    data1: 7,
    data2: 0,
  });
  // Sent by the runtime, through the IMP, and called by the program.
  let sent = 0;
  if (click !== null) {
    send_mouse_down(canvas, click);
    sent = mouseData;
    mouseData = 0;
    canvas.mouseDown({ with: click });
  }
  report(`mouse ${sent} ${mouseData}`);
  report(`records ${view_intrinsic_size(canvas)} ${view_alignment_rect(canvas)}`);
  // AppKit draws the canvas offscreen, as it draws it on screen, and the
  // pixel `draw` filled through Core Graphics reads back red.
  const rep = canvas.bitmapImageRepForCachingDisplay({ in: canvas.bounds });
  if (rep !== null) {
    canvas.cacheDisplay({ in: canvas.bounds, to: rep });
    const pixel = rep.colorAt({ x: 1, y: 1 });
    report(pixel === null ? "cached none" : `cached ${pixel.redComponent} ${pixel.greenComponent} ${pixel.blueComponent}`);
  }

  // Swift's `Timer.scheduledTimer(withTimeInterval:repeats:) { timer in ... }`:
  // the closure a block the timer keeps, and calls from the run loop.
  void animated(() => {
    Timer.scheduledTimer({ withTimeInterval: 0.05, repeats: true }, tick);
  });
  app.run();
  report("done");
}

main();
