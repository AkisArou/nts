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
