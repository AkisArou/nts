#include "nts_cf_host.h"

#include "nts_runtime.h"
#include "nts_uv_host.h"

#include <Block.h>
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
 * block) may have posted a task or a timer since the last pump.
 *
 * The descriptor's callback is re-enabled here every time, not only when it
 * was parked. CoreFoundation turns it off when the kqueue becomes readable and
 * on only when asked, and a pump the timer drove can take the event before
 * the callback is delivered -- which then never is. With nothing left to turn
 * it on, the run loop slept through every later post from another thread:
 * one run in twenty of `macos-blocks`' off-thread arm, with the completion
 * queued. Enabling an enabled callback costs nothing, and one whose kqueue is
 * readable fires. */
static void nts_cf_before_waiting(CFRunLoopObserverRef observer,
                                  CFRunLoopActivity activity, void *info) {
  (void)observer;
  (void)activity;
  (void)info;
  if (!nts_in_callback()) {
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
  /* A short string -- most of them, and every tagged-pointer one, which has
   * no storage to point at -- copied out as ASCII in one call, which fails
   * for anything that is not. Tried before asking for the storage, which a
   * tagged string never has: that call would be a message answered with
   * NULL every time. */
  if (length < 64) {
    char ascii[64];
    if (CFStringGetCString(string, ascii, sizeof ascii,
                           kCFStringEncodingASCII)) {
      NtsString *out = nts_str_raw((uint32_t)length, 0);
      memcpy(NTS_ELEMENTS(out, unsigned char), ascii, (size_t)length);
      return out;
    }
  } else {
    const char *bytes = CFStringGetCStringPtr(string, kCFStringEncodingASCII);
    if (bytes) {
      NtsString *out = nts_str_raw((uint32_t)length, 0);
      memcpy(NTS_ELEMENTS(out, unsigned char), bytes, (size_t)length);
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

/* Each takes `null` too, Swift's nil for an `[T]?` argument, and makes no
 * array of it. */
void *nts_nsarray_of_objects(const NtsArray *array) {
  if (!array) {
    return NULL;
  }
  /* The array's own element block is the C array of objects CFArrayCreate
   * takes, and its callbacks retain each for the NSArray. */
  return (void *)CFArrayCreate(NULL, (const void **)NTS_ITEMS(array, void *),
                               (CFIndex)array->header.length,
                               &kCFTypeArrayCallBacks);
}

void *nts_nsarray_of_strings(const NtsArray *array) {
  if (!array) {
    return NULL;
  }
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

/* The object a map holds in a box of its family -- a header, then the handle,
 * `handle_box`'s layout -- or NULL for a value that is not one. */
static const void *nts_boxed_handle(NtsValue value) {
  const NtsHeader *box = nts_value_reference(value);
  if (!box) {
    return NULL;
  }
  const void *handle;
  memcpy(&handle, (const unsigned char *)box + sizeof(NtsHeader), sizeof handle);
  return handle;
}

static void *nts_nsdictionary_of(const NtsMap *map, bool strings) {
  if (!map) {
    return NULL;
  }
  CFMutableDictionaryRef made = CFDictionaryCreateMutable(
      NULL, 0, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
  for (double at = nts_map_next(map, 0); at >= 0; at = nts_map_next(map, at + 1)) {
    /* Both come back owned, and are given back once read. */
    NtsValue key = nts_map_key_at(map, at);
    NtsValue value = nts_map_value_at(map, at);
    void *name = nts_nsstring_of((const NtsString *)nts_value_reference(key));
    if (strings) {
      void *text = nts_nsstring_of((const NtsString *)nts_value_reference(value));
      if (text) {
        CFDictionarySetValue(made, name, text);
        CFRelease(text);
      }
    } else {
      const void *object = nts_boxed_handle(value);
      if (object) {
        CFDictionarySetValue(made, name, object);
      }
    }
    CFRelease(name);
    nts_value_release(key);
    nts_value_release(value);
  }
  return (void *)made;
}

static void nts_dictionary_fill(NtsArray *keys, NtsArray *values, const void *dictionary, bool strings) {
  CFIndex count = (CFIndex)keys->header.length;
  const void *small[2][32];
  const void **names = count <= 32 ? small[0] : malloc((size_t)count * sizeof(void *));
  const void **objects = count <= 32 ? small[1] : malloc((size_t)count * sizeof(void *));
  if (!names || !objects) {
    abort();
  }
  CFDictionaryGetKeysAndValues((CFDictionaryRef)dictionary, names, objects);
  for (CFIndex at = 0; at < count; at++) {
    NTS_ITEMS(keys, NtsString *)[at] = nts_string_of_nsstring(names[at]);
    if (strings) {
      NTS_ITEMS(values, NtsString *)[at] = nts_string_of_nsstring(objects[at]);
    } else {
      CFRetain(objects[at]);
      NTS_ITEMS(values, const void *)[at] = objects[at];
    }
  }
  if (names != small[0]) {
    free(names);
    free(objects);
  }
}

void nts_dictionary_fill_from_nsdictionary(NtsArray *keys, NtsArray *values, const void *dictionary) {
  nts_dictionary_fill(keys, values, dictionary, false);
}

void nts_dictionary_fill_strings_from_nsdictionary(NtsArray *keys, NtsArray *values, const void *dictionary) {
  nts_dictionary_fill(keys, values, dictionary, true);
}

void *nts_nsdictionary_of_objects(const NtsMap *map) {
  return nts_nsdictionary_of(map, false);
}

void *nts_nsdictionary_of_strings(const NtsMap *map) {
  return nts_nsdictionary_of(map, true);
}

/* A registered class with fields: where its ivar is, and what makes the
 * object that goes in it. Few enough that a scan beats anything cleverer; the
 * last one found is remembered, since a program reads one class's fields in a
 * row. */
typedef struct NtsObjcStateful {
  Class cls;
  ptrdiff_t offset;
  void *(*make)(void);
} NtsObjcStateful;
static NtsObjcStateful *nts_objc_stateful;
static uint32_t nts_objc_stateful_count;
static const NtsObjcStateful *nts_objc_stateful_last;

/* The registered class `self` is an instance of, or of a subclass of: the
 * platform may subclass it (KVO does, at run time). */
static const NtsObjcStateful *nts_objc_stateful_of(id self) {
  Class cls = object_getClass(self);
  const NtsObjcStateful *last = nts_objc_stateful_last;
  if (last && last->cls == cls) {
    return last;
  }
  for (; cls; cls = class_getSuperclass(cls)) {
    for (uint32_t at = 0; at < nts_objc_stateful_count; at++) {
      if (nts_objc_stateful[at].cls == cls) {
        nts_objc_stateful_last = &nts_objc_stateful[at];
        return nts_objc_stateful_last;
      }
    }
  }
  fprintf(stderr, "nts: %s has no fields of a program's class to read\n",
          class_getName(object_getClass(self)));
  abort();
}

static void **nts_objc_state_slot(id self, const NtsObjcStateful *class) {
  return (void **)((char *)self + class->offset);
}

void *nts_objc_state(void *self) {
  const NtsObjcStateful *class = nts_objc_stateful_of((id)self);
  void **slot = nts_objc_state_slot((id)self, class);
  if (!*slot) {
    *slot = class->make();
  }
  return *slot;
}

/* `init` for a class with fields: the superclass's, then the fields, so they
 * hold their initial values by the time `new` returns, as JavaScript's do. */
static id nts_objc_state_init(id self, SEL cmd) {
  const NtsObjcStateful *class = nts_objc_stateful_of(self);
  struct objc_super super = {self, class_getSuperclass(class->cls)};
  self = ((id (*)(struct objc_super *, SEL))objc_msgSendSuper)(&super, cmd);
  if (self) {
    nts_objc_state(self);
  }
  return self;
}

/* `dealloc`: the fields given back, then the superclass's. */
static void nts_objc_state_dealloc(id self, SEL cmd) {
  const NtsObjcStateful *class = nts_objc_stateful_of(self);
  void **slot = nts_objc_state_slot(self, class);
  void *state = *slot;
  *slot = NULL;
  nts_release(state);
  struct objc_super super = {self, class_getSuperclass(class->cls)};
  ((void (*)(struct objc_super *, SEL))objc_msgSendSuper)(&super, cmd);
}

void nts_objc_register_class(const char *name, const char *superclass,
                             const NtsObjcMethod *methods, uint32_t count,
                             void *(*make_state)(void)) {
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
  if (!make_state) {
    objc_registerClassPair(made);
    return;
  }
  class_addIvar(made, "nts_state", sizeof(void *), sizeof(void *) == 8 ? 3 : 2,
                "^v");
  class_addMethod(made, sel_registerName("init"), (IMP)nts_objc_state_init,
                  "@16@0:8");
  class_addMethod(made, sel_registerName("dealloc"),
                  (IMP)nts_objc_state_dealloc, "v16@0:8");
  objc_registerClassPair(made);
  NtsObjcStateful *grown =
      realloc(nts_objc_stateful, (nts_objc_stateful_count + 1) * sizeof *grown);
  if (!grown) {
    fprintf(stderr, "nts: out of memory\n");
    abort();
  }
  nts_objc_stateful = grown;
  nts_objc_stateful_last = NULL;
  nts_objc_stateful[nts_objc_stateful_count++] = (NtsObjcStateful){
      made, ivar_getOffset(class_getInstanceVariable(made, "nts_state")),
      make_state};
}

/* ARC's entry points, which no public header declares. */
id objc_retain(id object);
void objc_release(id object);

/* A carried block call: the block, what runs it, and the arguments' copy,
 * with the offsets of the objects in it that it holds a count of. */
typedef struct NtsBlockCarried {
  const void *block;
  void (*run)(const void *block, void *arguments);
  uint32_t count;
  uint32_t objects[8];
  unsigned char arguments[];
} NtsBlockCarried;

static void nts_block_carried_free(NtsBlockCarried *carried) {
  for (uint32_t at = 0; at < carried->count; at++) {
    void *object;
    memcpy(&object, carried->arguments + carried->objects[at], sizeof object);
    objc_release(object);
  }
  _Block_release(carried->block);
  free(carried);
}

static void nts_block_carried_run(void *state) {
  NtsBlockCarried *carried = state;
  carried->run(carried->block, carried->arguments);
  nts_block_carried_free(carried);
}

static void nts_block_carried_drop(void *state) {
  nts_block_carried_free(state);
}

void nts_block_carry(const void *block, const void *arguments, size_t size,
                     const uint32_t *objects, uint32_t count,
                     void (*run)(const void *block, void *arguments)) {
  if (count > 8) {
    fprintf(stderr, "nts: a block given more than eight objects was called off "
                    "the thread that owns its closure\n");
    abort();
  }
  NtsBlockCarried *carried = malloc(sizeof *carried + size);
  if (!carried) {
    fprintf(stderr, "nts: out of memory\n");
    abort();
  }
  carried->block = _Block_copy(block);
  carried->run = run;
  carried->count = count;
  memcpy(carried->arguments, arguments, size);
  for (uint32_t at = 0; at < count; at++) {
    void *object;
    carried->objects[at] = objects[at];
    memcpy(&object, carried->arguments + objects[at], sizeof object);
    objc_retain(object);
  }
  nts_post_from_any_thread(
      (NtsTask){nts_block_carried_run, nts_block_carried_drop, carried});
}

static void nts_block_unlend_run(void *context) { nts_closure_unlend(context); }

void nts_block_unlend(void *context) {
  nts_post_from_any_thread((NtsTask){nts_block_unlend_run, 0, context});
}

void nts_objc_adopt(const char *name, const char *protocol) {
  Protocol *adopted = objc_getProtocol(protocol);
  Class made = objc_getClass(name);
  if (adopted && made) {
    class_addProtocol(made, adopted);
  }
}
