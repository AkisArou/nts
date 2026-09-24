#include "nts_cf_host.h"

#include "nts_runtime.h"
#include "nts_uv_host.h"

#include <CoreFoundation/CoreFoundation.h>
#include <objc/message.h>
#include <objc/runtime.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* libobjc exports these and no public header declares them; they are the
 * calls clang's `@autoreleasepool` makes. The CF host is only linked into a
 * program that sends Objective-C messages, which already links libobjc. */
void *objc_autoreleasePoolPush(void);
void objc_autoreleasePoolPop(void *pool);

static CFFileDescriptorRef nts_cf_descriptor;
static CFRunLoopSourceRef nts_cf_source;
static CFRunLoopTimerRef nts_cf_timer;
static CFRunLoopObserverRef nts_cf_observer;

/* Whether the descriptor's callback was left off because a TypeScript
 * callback was running when libuv's kqueue became readable. */
static bool nts_cf_parked;

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

/* A CFFileDescriptor's callbacks are one-shot, so leaving them off is how
 * the descriptor is parked: under a TypeScript callback nothing may pump, and
 * re-enabled there a still-readable kqueue would fire again at once, for as
 * long as the nested loop ran -- a second of it measured a second of CPU. The
 * before-waiting observer re-enables it once the callback has returned. */
static void nts_cf_readable(CFFileDescriptorRef descriptor, CFOptionFlags flags,
                            void *info) {
  (void)flags;
  (void)info;
  if (nts_in_callback()) {
    nts_cf_parked = true;
    return;
  }
  nts_cf_pump();
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
  if (nts_cf_parked && !nts_in_callback()) {
    nts_cf_parked = false;
    CFFileDescriptorEnableCallBacks(nts_cf_descriptor,
                                    kCFFileDescriptorReadCallBack);
  }
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
  nts_cf_parked = false;
  nts_cf_observer = NULL;
  nts_cf_timer = NULL;
  nts_cf_source = NULL;
  nts_cf_descriptor = NULL;
}

char *nts_nserror_message(void *error) {
  id description = ((id (*)(id, SEL))objc_msgSend)(
      (id)error, sel_registerName("localizedDescription"));
  const char *text = ((const char *(*)(id, SEL))objc_msgSend)(
      description, sel_registerName("UTF8String"));
  return strdup(text ? text : "");
}

void *nts_nsstring_of(const NtsString *string) {
  if (!string) {
    return NULL;
  }
  CFIndex length = (CFIndex)string->length;
  /* One-byte storage is Latin-1 by construction, which CoreFoundation keeps
   * as it is: no widening to UTF-16 on the way. */
  if (!(string->flags & NTS_TWO_BYTE)) {
    return (void *)CFStringCreateWithBytes(
        NULL, NTS_ELEMENTS(string, const UInt8), length,
        kCFStringEncodingISOLatin1, false);
  }
  return (void *)CFStringCreateWithCharacters(
      NULL, NTS_ELEMENTS(string, const UniChar), length);
}

NtsString *nts_string_of_nsstring(const void *object) {
  if (!object) {
    return NULL;
  }
  CFStringRef string = (CFStringRef)object;
  CFIndex length = CFStringGetLength(string);
  const char *bytes = CFStringGetCStringPtr(string, kCFStringEncodingASCII);
  if (bytes) {
    NtsString *out = nts_str_raw((uint32_t)length, 0);
    memcpy(NTS_ELEMENTS(out, unsigned char), bytes, (size_t)length);
    return out;
  }
  /* A short string -- most of them, and every tagged-pointer one, which has
   * no storage to point at -- copied out as ASCII in one call, which fails
   * for anything that is not. */
  if (length < 64) {
    char ascii[64];
    if (CFStringGetCString(string, ascii, sizeof ascii,
                           kCFStringEncodingASCII)) {
      NtsString *out = nts_str_raw((uint32_t)length, 0);
      memcpy(NTS_ELEMENTS(out, unsigned char), ascii, (size_t)length);
      return out;
    }
  }
  const UniChar *units = CFStringGetCharactersPtr(string);
  if (units) {
    return nts_str_alloc(units, (uint32_t)length);
  }
  UniChar small[128];
  UniChar *buffer =
      length <= 128 ? small : malloc((size_t)length * sizeof(UniChar));
  if (!buffer) {
    abort();
  }
  CFStringGetCharacters(string, CFRangeMake(0, length), buffer);
  NtsString *out = nts_str_alloc(buffer, (uint32_t)length);
  if (buffer != small) {
    free(buffer);
  }
  return out;
}

void *nts_nsarray_of_objects(const NtsArray *array) {
  /* The array's own element block is the C array of objects CFArrayCreate
   * takes, and its callbacks retain each for the NSArray. */
  return (void *)CFArrayCreate(NULL, (const void **)NTS_ITEMS(array, void *),
                               (CFIndex)array->header.length,
                               &kCFTypeArrayCallBacks);
}

void *nts_nsarray_of_strings(const NtsArray *array) {
  uint32_t count = array->header.length;
  void *small[64];
  void **strings = count <= 64 ? small : malloc((size_t)count * sizeof(void *));
  if (!strings) {
    abort();
  }
  for (uint32_t at = 0; at < count; at++) {
    strings[at] = nts_nsstring_of(NTS_ITEMS(array, NtsString *)[at]);
  }
  CFArrayRef made = CFArrayCreate(NULL, (const void **)strings, (CFIndex)count,
                                  &kCFTypeArrayCallBacks);
  for (uint32_t at = 0; at < count; at++) {
    CFRelease(strings[at]);
  }
  if (strings != small) {
    free(strings);
  }
  return (void *)made;
}

void nts_array_fill_from_nsarray(NtsArray *into, const void *array) {
  CFIndex count = (CFIndex)into->header.length;
  const void **items = (const void **)NTS_ITEMS(into, void *);
  CFArrayGetValues((CFArrayRef)array, CFRangeMake(0, count), items);
  for (CFIndex at = 0; at < count; at++) {
    CFRetain(items[at]);
  }
}

void nts_array_fill_strings_from_nsarray(NtsArray *into, const void *array) {
  CFIndex count = (CFIndex)into->header.length;
  for (CFIndex at = 0; at < count; at++) {
    NTS_ITEMS(into, NtsString *)
    [at] =
        nts_string_of_nsstring(CFArrayGetValueAtIndex((CFArrayRef)array, at));
  }
}

void nts_objc_register_class(const char *name, const char *superclass,
                             const NtsObjcMethod *methods, uint32_t count) {
  Class base = objc_getClass(superclass);
  if (!base) {
    fprintf(stderr, "nts: no Objective-C class %s for %s to extend\n",
            superclass, name);
    abort();
  }
  Class made = objc_allocateClassPair(base, name, 0);
  if (!made) {
    fprintf(stderr, "nts: an Objective-C class named %s already exists\n",
            name);
    abort();
  }
  for (uint32_t at = 0; at < count; at++) {
    class_addMethod(made, sel_registerName(methods[at].selector),
                    (IMP)methods[at].implementation, methods[at].types);
  }
  objc_registerClassPair(made);
}
