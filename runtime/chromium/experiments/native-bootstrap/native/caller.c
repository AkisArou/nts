#include "probe.h"

#include <stdio.h>

int main(void) {
  for (int document = 0; document < 20; ++document) {
    NtsChromiumProbe* probe = nts_chromium_probe_create();
    NtsChromiumProbeResult result = nts_chromium_probe_run(probe);
    if (result.scalar != 50.0 || !result.text_matches ||
        result.live_objects_before != result.live_objects_after)
      return 1;
    nts_chromium_probe_counter_initialize(probe);
    for (int step = 1; step <= 10; ++step) {
      NtsChromiumCounterResult counter =
          nts_chromium_probe_counter_increment(probe);
      if (counter.count != step || counter.live_objects_before != 1 ||
          counter.live_objects_after != 1)
        return 2;
    }
    nts_chromium_probe_destroy(probe);
  }
  puts(
      "PASS: scalar=50, text=native:probe, 20 environment create/run/destroy "
      "cycles, independent managed counters 1..10, no live object growth");
  return 0;
}
