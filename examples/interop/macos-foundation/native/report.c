#include "report.h"

#include <objc/runtime.h>
#include <stdio.h>
#include <stdlib.h>

// libobjc's weak-reference entry points, which no public header declares.
id objc_initWeak(id *location, id value);
id objc_loadWeakRetained(id *location);
void objc_release(id value);

void report(const char *line) {
  fputs(line, stdout);
  fputc('\n', stdout);
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
  // Retained by the load, so the answer cannot change under the question;
  // given back at once.
  id object = objc_loadWeakRetained(&watches[watch]);
  if (object) objc_release(object);
  return object != 0;
}
