/* A standalone module that schedules through the real native Node owners.
 * Its main is the compiler's standalone_main(true), rather than a test that
 * drives uv_run itself: otherwise an inactive nts host could go unnoticed.
 * Each process selects one operation; the Node oracle uses the matching API.
 */
#include "../../node/crypto/nts_crypto.h"
#include "../../node/fs/fs.h"
#include "../../node/timers/nts_timers.h"
#include "nts_runtime.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

const uint32_t nts_closure_call_slot = 0;

static void timer_done(NtsHeader *self, double now) {
  (void)self;
  (void)now;
  nts_timers_cancel();
  puts("timer");
}

static void fs_done(NtsHeader *self, double status) {
  (void)self;
  if (status != 0) {
    fputs("native fs access failed\n", stderr);
    exit(1);
  }
  puts("fs");
}

static void crypto_done(NtsHeader *self, bool ok, NtsView *result) {
  (void)self;
  if (!ok || nts_view_byte_length(result) != 32) {
    fputs("native digest failed\n", stderr);
    exit(1);
  }
  const unsigned char *bytes = nts_view_bytes(result);
  fputs("crypto ", stdout);
  for (unsigned i = 0; i < 32; i++) {
    printf("%02x", (unsigned)bytes[i]);
  }
  putchar('\n');
}

static void *const timer_methods[] = {
    (void *)(void (*)(NtsHeader *, double))timer_done};
static void *const fs_methods[] = {
    (void *)(void (*)(NtsHeader *, double))fs_done};
static void *const crypto_methods[] = {
    (void *)(void (*)(NtsHeader *, bool, NtsView *))crypto_done};
static const NtsDescriptor timer_desc = {
    .kind = NTS_KIND_OBJECT,
    .size = sizeof(NtsHeader),
    .methods = timer_methods,
    .name = "NativeTimerDone",
};
static const NtsDescriptor fs_desc = {
    .kind = NTS_KIND_OBJECT,
    .size = sizeof(NtsHeader),
    .methods = fs_methods,
    .name = "NativeFsDone",
};
static const NtsDescriptor crypto_desc = {
    .kind = NTS_KIND_OBJECT,
    .size = sizeof(NtsHeader),
    .methods = crypto_methods,
    .name = "NativeCryptoDone",
};
static NtsHeader timer_callback = {&timer_desc, NTS_IMMORTAL, 0, 0};
static NtsHeader fs_callback = {&fs_desc, NTS_IMMORTAL, 0, 0};
static NtsHeader crypto_callback = {&crypto_desc, NTS_IMMORTAL, 0, 0};

void module__init(void) {
  const char *case_name = getenv("NTS_NATIVE_LOOP_CASE");
  if (case_name && strcmp(case_name, "timer") == 0) {
    nts_timers_install(&timer_callback, NULL);
    nts_timers_schedule(1);
  } else if (case_name && strcmp(case_name, "fs") == 0) {
    const char *file_name = getenv("NTS_NATIVE_LOOP_FILE");
    if (!file_name) {
      abort();
    }
    NtsString *path = nts_string_from_utf8(file_name, strlen(file_name));
    nts_fs_access_async(path, 0, &fs_callback);
    nts_release((NtsHeader *)path);
  } else if (case_name && strcmp(case_name, "crypto") == 0) {
    NtsString *name = nts_string_from_utf8("sha256", 6);
    double id = nts_crypto_digest_id(name);
    nts_release((NtsHeader *)name);
    nts_crypto_digest_job(id, NULL, -1, &crypto_callback);
  } else if (case_name && strcmp(case_name, "control") == 0) {
    puts("control");
  } else {
    abort();
  }
}
