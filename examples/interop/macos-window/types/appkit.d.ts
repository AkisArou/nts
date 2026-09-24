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
  import type { ObjcClass, ObjcMeta } from "objc:types";
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

  // The class objects, each a value whose statics interface holds the class
  // methods: `NSWindow.alloc()` is a message to the class `NSWindow`.
  export interface NSObjectStatics {
    /**
     * Quoted, because `new(...)` in an interface is a construct signature.
     * @ntsSelector new
     */
    "new"(this: NtsWindowControllerMeta): NtsWindowController;
  }
  export const NSObject: ObjcMeta<"NSObject">;
  export type NtsWindowControllerMeta = ObjcMeta<"NtsWindowController"> & NSObjectStatics;
  export const NtsWindowController: NtsWindowControllerMeta;

  export interface NSApplicationStatics {
    /** @ntsSelector sharedApplication */
    sharedApplication(this: NSApplicationMeta): NSApplication;
  }
  export type NSApplicationMeta = ObjcMeta<"NSApplication"> & NSApplicationStatics;
  export const NSApplication: NSApplicationMeta;

  export interface NSWindowStatics {
    /** @ntsSelector alloc */
    alloc(this: NSWindowMeta): NSWindow;
  }
  export type NSWindowMeta = ObjcMeta<"NSWindow"> & NSWindowStatics;
  export const NSWindow: NSWindowMeta;

  export interface NSButtonStatics {
    /** @ntsSelector alloc */
    alloc(this: NSButtonMeta): NSButton;
  }
  export type NSButtonMeta = ObjcMeta<"NSButton"> & NSButtonStatics;
  export const NSButton: NSButtonMeta;

  export interface NSStringStatics {
    /** @ntsSelector stringWithUTF8String: */
    stringWithUTF8String(this: NSStringMeta, text: string): NSString;
  }
  export type NSStringMeta = ObjcMeta<"NSString"> & NSStringStatics;
  export const NSString: NSStringMeta;

  export interface NSTimerStatics {
    /** @ntsSelector scheduledTimerWithTimeInterval:target:selector:userInfo:repeats: */
    scheduledTimerWithTimeIntervalTargetSelectorUserInfoRepeats(
      this: NSTimerMeta,
      interval: c_double,
      target: NSObject,
      name: Selector,
      userInfo: NSObject | null,
      repeats: boolean,
    ): NSTimer;
  }
  export type NSTimerMeta = ObjcMeta<"NSTimer"> & NSTimerStatics;
  export const NSTimer: NSTimerMeta;

  export interface NSEventStatics {
    /**
     * `NSEventTypeApplicationDefined`, posted after `stop:` so the loop wakes
     * and sees it.
     * @ntsSelector otherEventWithType:location:modifierFlags:timestamp:windowNumber:context:subtype:data1:data2:
     */
    otherEventWithTypeLocationModifierFlagsTimestampWindowNumberContextSubtypeData1Data2(
      this: NSEventMeta,
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
  export type NSEventMeta = ObjcMeta<"NSEvent"> & NSEventStatics;
  export const NSEvent: NSEventMeta;
}
