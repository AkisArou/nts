/* Failed HRESULT outputs grant no ownership. Clearing their storage must not
 * touch their former pointees or adjacent slots; success (S_OK and S_FALSE)
 * preserves every byte, including pointer/count/record representations. */
#include "nts_runtime.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>

int main(void) {
  const int32_t statuses[] = {0, 1, INT32_MAX, -1, INT32_MIN};
  const size_t sizes[] = {1, 4, sizeof(void *), 64};
  unsigned checks = 0;
  for (size_t s = 0; s < sizeof(statuses) / sizeof(statuses[0]); ++s) {
    for (size_t n = 0; n < sizeof(sizes) / sizeof(sizes[0]); ++n) {
      unsigned char storage[66];
      memset(storage, 0xa5, sizeof storage);
      nts_hresult_clear(statuses[s], storage + 1, sizes[n]);
      for (size_t at = 0; at < sizeof storage; ++at) {
        unsigned char expected =
            statuses[s] < 0 && at >= 1 && at <= sizes[n] ? 0 : 0xa5;
        assert(storage[at] == expected);
      }
      ++checks;
    }
  }
  printf("%u HRESULT slot checks passed\n", checks);
  return 0;
}
