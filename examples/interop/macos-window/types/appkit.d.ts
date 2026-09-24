// Hand-written: the AppKit and Foundation this fixture sends, each selector
// checked by hand against the SDK's headers (NSApplication.h, NSWindow.h,
// NSButton.h, NSControl.h, NSView.h, NSEvent.h, NSTimer.h, NSString.h).
// `NSInteger` is `c_long` and `NSUInteger` `c_ulong`; `BOOL` crosses as
// `boolean`, one byte in a register on both slices. `NtsWindowController` is
// the class the program defines at run time.
/**
 * @ntsFramework AppKit
 * @ntsFramework Foundation
 */
declare module "objc:AppKit" {
  import type { ByValue, Struct, c_double, c_int16, c_long, c_ulong } from "c:types";
  import type { ObjcClass } from "objc:types";
  import type { Selector } from "objc:runtime";

  export type CGPoint = Struct<{ x: c_double; y: c_double }, "CGPoint">;
  export type CGSize = Struct<{ width: c_double; height: c_double }, "CGSize">;
  export type CGRect = Struct<{ origin: CGPoint; size: CGSize }, "CGRect">;

  export type NSObject = ObjcClass<"NSObject">;
  export type NSString = ObjcClass<"NSString", NSObject>;
  export type NSEvent = ObjcClass<"NSEvent", NSObject>;
  export type NSResponder = ObjcClass<"NSResponder", NSObject>;

  export interface NSApplicationOwnMethods {
    /** @ntsSelector setActivationPolicy: */
    setActivationPolicy(this: NSApplication, policy: c_long): boolean;
    /** @ntsSelector run */
    run(this: NSApplication): void;
    /** @ntsSelector stop: */
    stop(this: NSApplication, sender: NSObject | null): void;
    /** @ntsSelector postEvent:atStart: */
    postEvent(this: NSApplication, event: NSEvent, atStart: boolean): void;
  }
  export type NSApplication = ObjcClass<"NSApplication", NSResponder> & NSApplicationOwnMethods;

  export interface NSViewOwnMethods {
    /** @ntsSelector addSubview: */
    addSubview(this: NSView, view: NSView): void;
    /**
     * A 32-byte record returned: on x86_64 through `objc_msgSend_stret`.
     * @ntsSelector frame
     */
    frame(this: NSView): ByValue<CGRect>;
  }
  export type NSView = ObjcClass<"NSView", NSResponder> & NSViewOwnMethods;
  export type NSControl = ObjcClass<"NSControl", NSView> & NSViewOwnMethods;

  export interface NSButtonOwnMethods {
    /** @ntsSelector initWithFrame: */
    initWithFrame(this: NSButton, frame: ByValue<CGRect>): NSButton;
    /** @ntsSelector setTitle: */
    setTitle(this: NSButton, title: NSString): void;
    /** @ntsSelector setTarget: */
    setTarget(this: NSButton, target: NSObject | null): void;
    /** @ntsSelector setAction: */
    setAction(this: NSButton, action: Selector): void;
    /** @ntsSelector performClick: */
    performClick(this: NSButton, sender: NSObject | null): void;
  }
  export type NSButton = ObjcClass<"NSButton", NSControl> & NSViewOwnMethods & NSButtonOwnMethods;

  export interface NSWindowOwnMethods {
    /**
     * `NSRect`, `NSWindowStyleMask`, `NSBackingStoreType`, `BOOL`.
     * @ntsSelector initWithContentRect:styleMask:backing:defer:
     */
    initWithContentRect(
      this: NSWindow,
      contentRect: ByValue<CGRect>,
      style: c_ulong,
      backing: c_ulong,
      defer: boolean,
    ): NSWindow;
    /** @ntsSelector setTitle: */
    setTitle(this: NSWindow, title: NSString): void;
    /** @ntsSelector contentView */
    contentView(this: NSWindow): NSView;
    /** @ntsSelector makeKeyAndOrderFront: */
    makeKeyAndOrderFront(this: NSWindow, sender: NSObject | null): void;
    /** @ntsSelector frame */
    frame(this: NSWindow): ByValue<CGRect>;
  }
  export type NSWindow = ObjcClass<"NSWindow", NSResponder> & NSWindowOwnMethods;

  export interface NSTimerOwnMethods {
    /** @ntsSelector invalidate */
    invalidate(this: NSTimer): void;
  }
  export type NSTimer = ObjcClass<"NSTimer", NSObject> & NSTimerOwnMethods;
  export type NtsWindowController = ObjcClass<"NtsWindowController", NSObject>;

  /**
   * @ntsSelector sharedApplication
   * @ntsClass NSApplication
   */
  export function sharedApplication(): NSApplication;
  /**
   * @ntsSelector alloc
   * @ntsClass NSWindow
   */
  export function allocWindow(): NSWindow;
  /**
   * @ntsSelector alloc
   * @ntsClass NSButton
   */
  export function allocButton(): NSButton;
  /**
   * @ntsSelector new
   * @ntsClass NtsWindowController
   */
  export function newController(): NtsWindowController;
  /**
   * @ntsSelector stringWithUTF8String:
   * @ntsClass NSString
   */
  export function stringWithUTF8String(text: string): NSString;
  /**
   * @ntsSelector scheduledTimerWithTimeInterval:target:selector:userInfo:repeats:
   * @ntsClass NSTimer
   */
  export function scheduledTimer(
    interval: c_double,
    target: NSObject,
    name: Selector,
    userInfo: NSObject | null,
    repeats: boolean,
  ): NSTimer;
  /**
   * `NSEventTypeApplicationDefined`, posted after `stop:` so the loop wakes
   * and sees it.
   * @ntsSelector otherEventWithType:location:modifierFlags:timestamp:windowNumber:context:subtype:data1:data2:
   * @ntsClass NSEvent
   */
  export function otherEvent(
    type: c_ulong,
    location: ByValue<CGPoint>,
    flags: c_ulong,
    time: c_double,
    windowNumber: c_long,
    context: NSObject | null,
    subtype: c_int16,
    data1: c_long,
    data2: c_long,
  ): NSEvent;
}
