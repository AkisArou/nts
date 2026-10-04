#include "program.h"
#include <stdio.h>
int main(void) {
  module__init();
  NtsString *result = main_();
  const char *utf8 = nts_string_to_cstring(result);
  puts(utf8);
  nts_cstring_release(result, utf8);
  nts_release((NtsHeader *)result);
  return 0;
}
