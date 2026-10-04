#include "program.h"
#include <stdio.h>

int main(void) {
  module__init();
  NtsString *result = main_();
  const char *text = nts_string_to_cstring(result);
  puts(text);
  nts_cstring_release(result, text);
  nts_release((NtsHeader *)result);
  return 0;
}
