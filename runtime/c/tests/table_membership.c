#include "nts_runtime.h"
#include <stdio.h>

int main(void) {
  NtsString *name = nts_string_from_cstring("key");
  NtsValue key = nts_value_of_reference((NtsHeader *)name, NTS_TAG_STRING);
  NtsMap *table = nts_table_new(NTS_KEY_STRING);
  NtsValue record = nts_value_of_reference((NtsHeader *)table, NTS_TAG_OBJECT);
  assert(nts_table_membership(record, key) == 0);
  nts_map_set(table, key, nts_value_of_undefined(), NTS_KEY_STRING);
  assert(nts_table_membership(record, key) == 1);
  NtsMap *map = nts_map_new(NTS_KEY_STRING);
  nts_map_set(map, key, nts_value_of_undefined(), NTS_KEY_STRING);
  assert(nts_table_membership(
             nts_value_of_reference((NtsHeader *)map, NTS_TAG_OBJECT), key) ==
         -1);
  assert(nts_table_membership(nts_value_of_number(9), key) == -1);
  puts("all record membership checks passed");
  return 0;
}
