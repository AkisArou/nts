#include "program.h"
#include <stdio.h>

/* Programs with no module-level work have no initializer. */
extern void module__init(void) __attribute__((weak));

int main(void) {
  if (module__init)
    module__init();
  NtsString *result = main_();
  const char *text = nts_string_to_cstring(result);
  puts(text);
  nts_cstring_release(result, text);
  nts_release((NtsHeader *)result);
  return 0;
}
