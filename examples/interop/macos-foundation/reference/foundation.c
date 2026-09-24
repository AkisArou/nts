/* The oracle for macos-foundation: every message `src/main.ts` sends, sent
 * from hand-written C, printed in the same order and format, and each object
 * released exactly where ARC releases it.
 *
 * Both programs call Apple's Foundation on the same Mac, so this is the
 * library answering rather than a second implementation of it. What the
 * comparison checks is that the compiled TypeScript sends the same messages
 * with the same arguments, reads the same answers, and gives each object back
 * at the same point. The last two lines are that point, observed through
 * zeroing weak references.
 *
 * Written with the same typed-`objc_msgSend` casts clang emits for
 * Objective-C, so it compiles as C11 with no Objective-C compiler. */
#include <objc/message.h>
#include <objc/runtime.h>
#include <stdio.h>

/* Exported by libobjc, declared in no public header. */
void *objc_autoreleasePoolPush(void);
void objc_autoreleasePoolPop(void *pool);
id objc_retain(id value);
void objc_release(id value);
id objc_initWeak(id *location, id value);
id objc_loadWeakRetained(id *location);

#define SEL_(name) sel_registerName(name)
#define SEND0(R, receiver, sel) ((R(*)(id, SEL))objc_msgSend)((id)(receiver), SEL_(sel))
#define SEND1(R, A, receiver, sel, a) ((R(*)(id, SEL, A))objc_msgSend)((id)(receiver), SEL_(sel), a)

static const char *utf8(id string) { return SEND0(const char *, string, "UTF8String"); }

static const char *state(id *weak) {
  id object = objc_loadWeakRetained(weak);
  if (object) objc_release(object);
  return object ? "alive" : "gone";
}

int main(void) {
  void *pool = objc_autoreleasePoolPush();
  Class NSObject = objc_getRequiredClass("NSObject");
  Class NSString = objc_getRequiredClass("NSString");
  Class NSMutableArray = objc_getRequiredClass("NSMutableArray");
  const char *text = "\xce\xb1\xf0\x9f\x98\x80 hello";
  const char *other_text = "\xce\xb2\xf0\x9f\x98\x80 hello";

  /* +1 from alloc, consumed by init, which hands back +1. */
  id owned = SEND1(id, const char *, SEND0(id, NSString, "alloc"), "initWithUTF8String:", text);
  printf("length %lu\n", SEND0(unsigned long, owned, "length"));
  printf("utf8 %s\n", utf8(owned));
  printf("upper %s\n", utf8(SEND0(id, owned, "uppercaseString")));

  id same = SEND1(id, const char *, NSString, "stringWithUTF8String:", text);
  id other = SEND1(id, const char *, NSString, "stringWithUTF8String:", other_text);
  printf("equal %s %s\n", SEND1(BOOL, id, owned, "isEqualToString:", same) ? "true" : "false",
         SEND1(BOOL, id, owned, "isEqualToString:", other) ? "true" : "false");

  id array = SEND1(id, unsigned long, NSMutableArray, "arrayWithCapacity:", 2UL);
  SEND1(void, id, array, "addObject:", owned);
  SEND1(void, id, array, "addObject:", other);
  printf("count %lu\n", SEND0(unsigned long, array, "count"));
  id first = SEND1(id, unsigned long, array, "objectAtIndex:", 0UL);
  BOOL first_is = SEND1(BOOL, Class, first, "isKindOfClass:", SEND0(Class, NSString, "class"));
  printf("first %s\n", first_is ? utf8(first) : "not a string");
  BOOL array_is = SEND1(BOOL, Class, array, "isKindOfClass:", SEND0(Class, NSString, "class"));
  printf("array as string %s\n", array_is ? "a string" : "null");
  printf("array is array %s\n",
         SEND1(BOOL, Class, array, "isKindOfClass:", SEND0(Class, NSMutableArray, "class")) ? "true"
                                                                                           : "false");

  id held = SEND0(id, NSObject, "new");
  id held_weak = 0;
  objc_initWeak(&held_weak, held);
  printf("held %s\n", state(&held_weak));
  printf("held again %s\n", SEND1(BOOL, Class, held, "isKindOfClass:", SEND0(Class, NSString, "class")) ? "true" : "false");

  /* `scoped()`: +1 from new, released when its only reference dies. */
  id scoped_weak = 0;
  {
    id object = SEND0(id, NSObject, "new");
    objc_initWeak(&scoped_weak, object);
    objc_release(object);
  }
  printf("scoped new %s\n", state(&scoped_weak));

  /* `initialised()`: alloc consumed by init, and init's result released. */
  id init_weak = 0;
  {
    id object = SEND1(id, const char *, SEND0(id, NSString, "alloc"), "initWithUTF8String:",
                      "\xce\xb1\xf0\x9f\x98\x80 scoped");
    objc_initWeak(&init_weak, object);
    objc_release(object);
  }
  printf("scoped init %s\n", state(&init_weak));

  /* `inAField()`: the holder's field is the only reference, released when
   * the holder dies. */
  id field_weak = 0;
  {
    id object = SEND0(id, NSObject, "new");
    objc_initWeak(&field_weak, object);
    objc_release(object);
  }
  printf("in a field %s\n", state(&field_weak));

  /* `captured()`: the closure's environment is the only reference. */
  id captured_weak = 0;
  {
    id object = SEND0(id, NSObject, "new");
    objc_initWeak(&captured_weak, object);
    (void)SEND1(BOOL, Class, object, "isKindOfClass:", SEND0(Class, NSString, "class"));
    objc_release(object);
  }
  printf("captured %s\n", state(&captured_weak));

  objc_release(held);
  objc_release(owned);
  objc_autoreleasePoolPop(pool);
  return 0;
}
