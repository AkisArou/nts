/* Standalone runtime RSS fixture, gated by runtime_checkpoint.rs. No explicit
 * collection inside this parse-shaped workload. Its arrays remain cyclic
 * types: the fixture proves a lifetime, not an acyclic descriptor override.
 * This is a memory-bound assertion, independent of the RC-elision ratchets. */
#define _POSIX_C_SOURCE 200809L
#include "nts_runtime.h"
#include <stddef.h>
#include <stdio.h>
#if defined(__linux__)
#include <unistd.h>
#endif

typedef struct Value {
  NtsHeader header;
  NtsArray *items;
  NtsArray *keys;
} Value;
static const uint32_t fields[] = {offsetof(Value, items),
                                  offsetof(Value, keys)};
static const NtsDescriptor value_desc = {NTS_KIND_OBJECT,
                                         sizeof(Value),
                                         2u,
                                         1u,
                                         fields,
                                         0,
                                         "Value",
                                         0u,
                                         0,
                                         NTS_ARRAY_UNKNOWN,
                                         0u,
                                         0,
                                         0,
                                         0,
                                         NULL,
                                         NULL};
static const NtsDescriptor refs = {NTS_KIND_ARRAY,
                                   sizeof(NtsHeader *),
                                   1u,
                                   1u,
                                   0,
                                   0,
                                   "refs",
                                   0u,
                                   0,
                                   NTS_ARRAY_REFERENCE,
                                   0u,
                                   0,
                                   0,
                                   0,
                                   NULL,
                                   NULL};

static size_t rss(void) {
#if defined(__linux__)
  unsigned long total, resident;
  FILE *f = fopen("/proc/self/statm", "r");
  if (!f || fscanf(f, "%lu %lu", &total, &resident) != 2)
    return SIZE_MAX;
  fclose(f);
  return resident * (size_t)sysconf(_SC_PAGESIZE);
#else
  return 0; /* Counted-storage bound below is portable; RSS is Linux's. */
#endif
}

int main(void) {
  Value *anchors[3];
  for (size_t i = 0; i < 3; i++)
    anchors[i] = (Value *)nts_object_new(&value_desc);
  size_t before = nts_live_count(), initial_rss = rss(), peak = initial_rss;
  if (initial_rss == SIZE_MAX)
    return 2;
  size_t answer = 0;
  for (size_t i = 0; i < 300000; i++) {
    Value *v = (Value *)nts_object_new(&value_desc);
    v->items = nts_array_new(&refs, 0);
    v->keys = nts_array_new(&refs, 0);
    nts_array_push_ref(v->items, NULL);
    nts_array_push_ref(v->keys, NULL);
    /* The builder and its result both hold each array, as parser frames do.
     * Giving the builder's alias back buffers a count-one candidate. */
    nts_retain(&v->items->header);
    nts_release(&v->items->header);
    nts_retain(&v->keys->header);
    nts_release(&v->keys->header);
    answer += v->items->header.length + v->keys->header.length;
    nts_release(&v->header);
    if (i % 1000 == 0) {
      size_t held = rss();
      if (held == SIZE_MAX)
        return 2;
      if (held > peak)
        peak = held;
    }
  }
  bool count_ok = nts_live_count() <= before + 20000;
  bool rss_ok = peak <= initial_rss + 32u * 1024u * 1024u;
  printf("%s parse-shaped iterations bound retained storage\n",
         count_ok ? "ok" : "FAIL");
#if defined(__linux__)
  printf("%s parse-shaped iterations bound RSS growth (peak=%zu base=%zu)\n",
         rss_ok ? "ok" : "FAIL", peak, initial_rss);
#else
  puts("SKIP RSS sampling requires Linux /proc; counted storage was checked");
#endif
  printf("%s every result was consumed\n", answer == 600000 ? "ok" : "FAIL");
  for (size_t i = 0; i < 3; i++)
    nts_release(&anchors[i]->header);
  nts_collect_cycles();
  return !(count_ok && rss_ok && answer == 600000);
}
