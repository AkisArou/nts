/* The oracle for macos-foundation: every message `src/main.ts` sends, sent
 * from hand-written C and printed in the same order and format.
 *
 * Both programs call Apple's Foundation on the same Mac, so this is the
 * library answering rather than a second implementation of it. What the
 * comparison checks is that the compiled TypeScript sends the same messages,
 * with the same arguments, and reads the same answers.
 *
 * Written with the same typed-`objc_msgSend` casts clang emits for
 * Objective-C, so it compiles as C11 with no Objective-C compiler. */
#include <objc/message.h>
#include <objc/runtime.h>
#include <stdio.h>

/* Exported by libobjc, declared in no public header. */
void *objc_autoreleasePoolPush(void);
void objc_autoreleasePoolPop(void *pool);

#define SEL_(name) sel_registerName(name)
#define SEND0(R, receiver, sel) ((R(*)(id, SEL))objc_msgSend)((id)(receiver), SEL_(sel))
#define SEND1(R, A, receiver, sel, a) ((R(*)(id, SEL, A))objc_msgSend)((id)(receiver), SEL_(sel), a)

static const char *utf8(id string) { return SEND0(const char *, string, "UTF8String"); }

int main(void) {
  void *pool = objc_autoreleasePoolPush();
  Class NSString = objc_getRequiredClass("NSString");
  Class NSMutableArray = objc_getRequiredClass("NSMutableArray");
  const char *text = "\xce\xb1\xf0\x9f\x98\x80 hello";
  const char *other_text = "\xce\xb2\xf0\x9f\x98\x80 hello";

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

  SEND0(id, owned, "retain");
  SEND0(void, owned, "release");
  printf("after retain/release %s\n", utf8(owned));

  SEND0(void, owned, "release");
  objc_autoreleasePoolPop(pool);
  return 0;
}
