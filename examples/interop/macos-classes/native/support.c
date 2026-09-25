#include "support.h"

#include <stdio.h>
#include <stdlib.h>

typedef struct objc_object *id;
typedef struct objc_selector *SEL;
id objc_initWeak(id *location, id value);
id objc_loadWeakRetained(id *location);
void objc_release(id value);
SEL sel_registerName(const char *name);
void objc_msgSend(void);
id objc_getClass(const char *name);
id object_getClass(id object);
size_t nts_live_count(void);
void nts_collect_cycles(void);

/* After a collection, as the gate's `rc` step counts: an object whose count
 * reached zero while it was a cycle candidate is freed by the next one. */
int live_objects(void) {
  nts_collect_cycles();
  return (int)nts_live_count();
}

void report(const char *line) {
  fputs(line, stdout);
  fputc('\n', stdout);
  fflush(stdout);
}

void report_string(const char *label, struct NSString *text) {
  const char *bytes = ((const char *(*)(id, SEL))objc_msgSend)((id)text, sel_registerName("UTF8String"));
  printf("%s %s\n", label, bytes);
  fflush(stdout);
}

static id watches[16];
static int watched;

int weak_watch(struct NSObject *object) {
  if (watched == 16) abort();
  objc_initWeak(&watches[watched], (id)object);
  return watched++;
}

bool weak_alive(int watch) {
  id object = objc_loadWeakRetained(&watches[watch]);
  if (object) objc_release(object);
  return object != 0;
}

/* Key-value observing, which replaces an observed object's class with one
 * the runtime makes below it (`NSKVONotifying_Loud`): a class the program
 * never wrote, reached where the program's own dispatch falls back to
 * asking `isKindOfClass:`. Answers whether the class was replaced. */
static id observer;

bool kvo_observe(struct NSObject *object) {
  id (*send)(id, SEL) = (id (*)(id, SEL))objc_msgSend;
  if (!observer) observer = send(send(objc_getClass("NSObject"), sel_registerName("alloc")), sel_registerName("init"));
  id before = object_getClass((id)object);
  ((void (*)(id, SEL, id, id, unsigned long, void *))objc_msgSend)(
      (id)object, sel_registerName("addObserver:forKeyPath:options:context:"), observer,
      ((id (*)(id, SEL, const char *))objc_msgSend)(objc_getClass("NSString"), sel_registerName("stringWithUTF8String:"), "tag"),
      0, 0);
  return object_getClass((id)object) != before;
}

void kvo_forget(struct NSObject *object) {
  ((void (*)(id, SEL, id, id))objc_msgSend)(
      (id)object, sel_registerName("removeObserver:forKeyPath:"), observer,
      ((id (*)(id, SEL, const char *))objc_msgSend)(objc_getClass("NSString"), sel_registerName("stringWithUTF8String:"), "tag"));
}
