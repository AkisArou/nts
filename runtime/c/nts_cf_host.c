#include "nts_cf_host.h"

#include "nts_runtime.h"
#include "nts_uv_host.h"

#include <CoreFoundation/CoreFoundation.h>

/* libobjc exports these and no public header declares them; they are the
 * calls clang's `@autoreleasepool` makes. The CF host is only linked into a
 * program that sends Objective-C messages, which already links libobjc. */
void *objc_autoreleasePoolPush(void);
void objc_autoreleasePoolPop(void *pool);

static CFFileDescriptorRef nts_cf_descriptor;
static CFRunLoopSourceRef nts_cf_source;
static CFRunLoopTimerRef nts_cf_timer;
static CFRunLoopObserverRef nts_cf_observer;

/* Far enough away to mean "never", and still a date CF can add to. */
static const CFTimeInterval nts_cf_never = 1.0e10;

/* The timer fires when libuv's next timeout is due, or never when libuv has
 * nothing alive: `nts_uv_host_backend_timeout` says -1 then, where libuv's own
 * answer is 0, and a timer armed at 0 would spin.
 *
 * Never, too, while a TypeScript callback is on the stack: the loop turning
 * now is one a native call made from inside the callback (`performClick:`,
 * menu tracking, a modal panel), and no task may start until the callback has
 * returned. Armed at libuv's 0 there, the timer would fire, be refused, and
 * fire again for as long as that nested loop ran. The outer loop's
 * before-waiting observer arms it once the callback is gone. */
static void nts_cf_rearm(void) {
  int due = nts_in_callback() ? -1 : nts_uv_host_backend_timeout();
  CFAbsoluteTime now = CFAbsoluteTimeGetCurrent();
  CFRunLoopTimerSetNextFireDate(
      nts_cf_timer, due < 0 ? now + nts_cf_never : now + (double)due / 1000.0);
}

/* One turn of libuv, inside a pool of its own -- unless a TypeScript callback
 * is still running below this loop, for the reason `nts_cf_rearm` gives. */
static void nts_cf_pump(void) {
  if (nts_in_callback()) {
    nts_cf_rearm();
    return;
  }
  void *pool = objc_autoreleasePoolPush();
  nts_uv_host_pump();
  objc_autoreleasePoolPop(pool);
  nts_cf_rearm();
}

static void nts_cf_readable(CFFileDescriptorRef descriptor, CFOptionFlags flags,
                            void *info) {
  (void)flags;
  (void)info;
  nts_cf_pump();
  /* A CFFileDescriptor's callbacks are one-shot. */
  CFFileDescriptorEnableCallBacks(descriptor, kCFFileDescriptorReadCallBack);
}

static void nts_cf_fired(CFRunLoopTimerRef timer, void *info) {
  (void)timer;
  (void)info;
  nts_cf_pump();
}

/* Before the loop sleeps: something outside libuv (an event handler, a
 * block) may have posted a task or a timer since the last pump. */
static void nts_cf_before_waiting(CFRunLoopObserverRef observer,
                                  CFRunLoopActivity activity, void *info) {
  (void)observer;
  (void)activity;
  (void)info;
  nts_cf_rearm();
}

void nts_cf_host_attach(void) {
  if (nts_cf_descriptor) {
    return;
  }
  CFRunLoopRef loop = CFRunLoopGetMain();
  nts_cf_descriptor = CFFileDescriptorCreate(NULL, nts_uv_host_backend_fd(),
                                             false, nts_cf_readable, NULL);
  CFFileDescriptorEnableCallBacks(nts_cf_descriptor,
                                  kCFFileDescriptorReadCallBack);
  nts_cf_source =
      CFFileDescriptorCreateRunLoopSource(NULL, nts_cf_descriptor, 0);
  CFRunLoopAddSource(loop, nts_cf_source, kCFRunLoopCommonModes);
  /* Repeating with an interval of "never", so firing does not invalidate it:
   * every arming goes through `CFRunLoopTimerSetNextFireDate`. */
  nts_cf_timer =
      CFRunLoopTimerCreate(NULL, CFAbsoluteTimeGetCurrent() + nts_cf_never,
                           nts_cf_never, 0, 0, nts_cf_fired, NULL);
  CFRunLoopAddTimer(loop, nts_cf_timer, kCFRunLoopCommonModes);
  nts_cf_observer = CFRunLoopObserverCreate(NULL, kCFRunLoopBeforeWaiting, true,
                                            0, nts_cf_before_waiting, NULL);
  CFRunLoopAddObserver(loop, nts_cf_observer, kCFRunLoopCommonModes);
  nts_cf_rearm();
}

void nts_cf_host_detach(void) {
  if (!nts_cf_descriptor) {
    return;
  }
  CFRunLoopObserverInvalidate(nts_cf_observer);
  CFRelease(nts_cf_observer);
  CFRunLoopTimerInvalidate(nts_cf_timer);
  CFRelease(nts_cf_timer);
  CFRunLoopSourceInvalidate(nts_cf_source);
  CFRelease(nts_cf_source);
  CFFileDescriptorInvalidate(nts_cf_descriptor);
  CFRelease(nts_cf_descriptor);
  nts_cf_observer = NULL;
  nts_cf_timer = NULL;
  nts_cf_source = NULL;
  nts_cf_descriptor = NULL;
}
