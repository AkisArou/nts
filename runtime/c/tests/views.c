/* Typed-array views: what a view is that an owning array is not.
 *
 * A `number[]` owns its elements inline; a `Uint8Array` is a *window* onto
 * storage something else may also see. Two views over one buffer alias
 * exactly, at different offsets and different element widths, and everything
 * below is a consequence of that.
 *
 * The expected values are transcribed from node. Three of the rules here agree
 * with a plausible wrong one on every input except a few, and the pool is
 * chosen to contain exactly those:
 *
 *   - `Uint8ClampedArray` rounds half to EVEN. `Math.round` agrees on every
 *     input except the exact halves, so the pool is mostly halves: 0.5 is 0,
 *     1.5 is 2, 2.5 is 2, 3.5 is 4.
 *   - `copyWithin` reads what it has already written. A forward loop is right
 *     on every non-overlapping range.
 *   - `set` between two kinds converts *values*. A byte move is right whenever
 *     the two kinds are identical, and wrong invisibly when only the widths
 *     match -- which is why `Float32Array` from `Int32Array` is here.
 */
#include <math.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>

#include "nts_runtime.h"

static int failures;

static void check(int held, const char *what) {
  if (held) {
    printf("ok   %s\n", what);
  } else {
    printf("FAIL %s\n", what);
    failures++;
  }
}

/* The pool, and it is mostly halves on purpose. */
static const double POOL[] = {
    0.0,  -0.0, 1.0,  -1.0,         0.5,          -0.5,  1.5,
    -1.5, 2.5,  3.5,  254.5,        255.5,        256.0, -1e9,
    1e9,  3.7,  -3.7, 2147483647.0, 4294967295.0, 1e300, -1e300};
#define POOL_LEN (sizeof(POOL) / sizeof(POOL[0]))

struct Row {
  unsigned kind;
  double expected[POOL_LEN];
};

/* Transcribed from node, one row per element kind. */
static const struct Row ROWS[] = {
    {NTS_ELEMENT_I8,
     {0.0,  0.0, 1.0, -1.0, 0.0, 0.0,  1.0,  -1.0, 2.0, 3.0, -2.0,
      -1.0, 0.0, 0.0, 0.0,  3.0, -3.0, -1.0, -1.0, 0.0, 0.0}},
    {NTS_ELEMENT_U8,
     {0.0,   0.0, 1.0, 255.0, 0.0, 0.0,   1.0,   255.0, 2.0, 3.0, 254.0,
      255.0, 0.0, 0.0, 0.0,   3.0, 253.0, 255.0, 255.0, 0.0, 0.0}},
    {NTS_ELEMENT_U8_CLAMPED,
     {0.0,   0.0,   1.0, 0.0,   0.0, 0.0, 2.0,   0.0,   2.0,   4.0, 254.0,
      255.0, 255.0, 0.0, 255.0, 4.0, 0.0, 255.0, 255.0, 255.0, 0.0}},
    {NTS_ELEMENT_I16,
     {0.0,   0.0,   1.0,     -1.0,     0.0, 0.0,  1.0,  -1.0, 2.0, 3.0, 254.0,
      255.0, 256.0, 13824.0, -13824.0, 3.0, -3.0, -1.0, -1.0, 0.0, 0.0}},
    {NTS_ELEMENT_U16, {0.0,     0.0, 1.0,     65535.0, 0.0,     0.0,   1.0,
                       65535.0, 2.0, 3.0,     254.0,   255.0,   256.0, 13824.0,
                       51712.0, 3.0, 65533.0, 65535.0, 65535.0, 0.0,   0.0}},
    {NTS_ELEMENT_I32,
     {0.0,          0.0, 1.0,  -1.0,         0.0,   0.0,   1.0,
      -1.0,         2.0, 3.0,  254.0,        255.0, 256.0, -1000000000.0,
      1000000000.0, 3.0, -3.0, 2147483647.0, -1.0,  0.0,   0.0}},
    {NTS_ELEMENT_U32,
     {0.0,   0.0,          1.0,          4294967295.0, 0.0,
      0.0,   1.0,          4294967295.0, 2.0,          3.0,
      254.0, 255.0,        256.0,        3294967296.0, 1000000000.0,
      3.0,   4294967293.0, 2147483647.0, 4294967295.0, 0.0,
      0.0}},
    {NTS_ELEMENT_F32,
     {0.0,
      -0.0,
      1.0,
      -1.0,
      0.5,
      -0.5,
      1.5,
      -1.5,
      2.5,
      3.5,
      254.5,
      255.5,
      256.0,
      -1000000000.0,
      1000000000.0,
      3.700000047683716,
      -3.700000047683716,
      2147483648.0,
      4294967296.0,
      INFINITY,
      -INFINITY}},
    {NTS_ELEMENT_F64,
     {0.0,          -0.0,          1.0,          -1.0, 0.5,   -0.5,
      1.5,          -1.5,          2.5,          3.5,  254.5, 255.5,
      256.0,        -1000000000.0, 1000000000.0, 3.7,  -3.7,  2147483647.0,
      4294967295.0, 1e+300,        -1e+300}},
};

static void every_kind_narrows_the_way_node_does(void) {
  for (unsigned row = 0; row < sizeof(ROWS) / sizeof(ROWS[0]); row++) {
    NtsBuffer *buffer = nts_buffer_new(64);
    NtsView *view = nts_view_new(buffer, 0, 8, (double)ROWS[row].kind, false);
    int agreed = 1;
    for (unsigned at = 0; at < POOL_LEN; at++) {
      nts_view_put(view, 0, POOL[at]);
      double got = nts_view_get(view, 0);
      /* By bit pattern, so a negative zero is not mistaken for a zero. */
      if (memcmp(&got, &ROWS[row].expected[at], sizeof(double)) != 0) {
        printf("     kind %u, %.17g: %.17g rather than %.17g\n", ROWS[row].kind,
               POOL[at], got, ROWS[row].expected[at]);
        agreed = 0;
      }
    }
    check(agreed, "every element kind narrows the way node does");
    nts_release((NtsHeader *)view);
    nts_release((NtsHeader *)buffer);
  }
}

static void copy_within_reads_what_it_has_written(void) {
  NtsBuffer *buffer = nts_buffer_new(8);
  NtsView *view = nts_view_new(buffer, 0, 8, NTS_ELEMENT_U8, false);
  for (unsigned at = 0; at < 8; at++) {
    nts_view_put(view, at, at + 1);
  }
  nts_view_copy_within(view, 2, 0, 5);
  /* node: 1 2 1 2 3 4 5 8. A forward loop gives 1 2 1 2 1 2 1 8. */
  static const double want[] = {1, 2, 1, 2, 3, 4, 5, 8};
  int agreed = 1;
  for (unsigned at = 0; at < 8; at++) {
    if (nts_view_get(view, at) != want[at]) {
      agreed = 0;
    }
  }
  check(agreed,
        "`copyWithin` over an overlapping range moves rather than loops");
  nts_release((NtsHeader *)view);
  nts_release((NtsHeader *)buffer);
}

static void set_between_kinds_converts_values(void) {
  /* Same width, different kind: the case that tells "compare the kind" from
     "compare the width". A byte move here reads the integers' bit patterns as
     denormal floats. */
  NtsBuffer *source = nts_buffer_new(8);
  NtsBuffer *destination = nts_buffer_new(8);
  NtsView *whole = nts_view_new(source, 0, 2, NTS_ELEMENT_I32, false);
  NtsView *real = nts_view_new(destination, 0, 2, NTS_ELEMENT_F32, false);
  nts_view_put(whole, 0, 3);
  nts_view_put(whole, 1, 4);
  nts_view_set(real, whole, 0);
  check(nts_view_get(real, 0) == 3.0 && nts_view_get(real, 1) == 4.0,
        "`set` across two kinds of one width converts values, not bytes");

  /* And over ONE buffer at two widths, where a wider destination overwrites
     elements the loop has not read yet. */
  NtsBuffer *shared = nts_buffer_new(8);
  NtsView *bytes = nts_view_new(shared, 0, 8, NTS_ELEMENT_U8, false);
  NtsView *pairs = nts_view_new(shared, 0, 4, NTS_ELEMENT_U16, false);
  for (unsigned at = 0; at < 8; at++) {
    nts_view_put(bytes, at, at + 1);
  }
  NtsView *first = nts_view_subarray(bytes, 0, 4);
  nts_view_set(pairs, first, 0);
  check(nts_view_get(pairs, 0) == 1 && nts_view_get(pairs, 1) == 2 &&
            nts_view_get(pairs, 2) == 3 && nts_view_get(pairs, 3) == 4,
        "and snapshots the source when the two share a buffer");

  nts_release((NtsHeader *)first);
  nts_release((NtsHeader *)pairs);
  nts_release((NtsHeader *)bytes);
  nts_release((NtsHeader *)shared);
  nts_release((NtsHeader *)real);
  nts_release((NtsHeader *)whole);
  nts_release((NtsHeader *)destination);
  nts_release((NtsHeader *)source);
}

static void a_view_is_a_window_and_a_slice_is_not(void) {
  NtsBuffer *buffer = nts_buffer_new(4);
  NtsView *whole = nts_view_new(buffer, 0, 4, NTS_ELEMENT_U8, false);
  NtsView *window = nts_view_subarray(whole, 1, 3);
  NtsView *copy = nts_view_slice(whole, 1, 3);
  nts_view_put(whole, 1, 99);
  check(nts_view_get(window, 0) == 99,
        "a subarray sees a write through the buffer");
  check(nts_view_get(copy, 0) == 0, "and a slice does not, because it copied");
  check(nts_view_buffer(window) == buffer, "a subarray keeps the buffer");
  check(nts_view_buffer(copy) != buffer, "and a slice has its own");
  nts_release((NtsHeader *)copy);
  nts_release((NtsHeader *)window);
  nts_release((NtsHeader *)whole);
  nts_release((NtsHeader *)buffer);
}

static void a_tracking_length_follows_its_buffer(void) {
  NtsBuffer *buffer = nts_buffer_new_resizable(8, 16);
  NtsView *tracking = nts_view_new(buffer, 0, 0, NTS_ELEMENT_U8, true);
  NtsView *cut = nts_view_subarray(tracking, 0, 4);
  check(nts_view_length(tracking) == 8,
        "a tracking view starts at its buffer's length");
  nts_buffer_resize(buffer, 16);
  check(nts_view_length(tracking) == 16, "and follows a resize");
  check(nts_view_length(cut) == 4,
        "while a subarray keeps the length it was cut to");

  /* Detachment, which every accessor has to survive. */
  NtsBuffer *moved = nts_buffer_transfer(buffer, 16, true);
  check(nts_view_length(tracking) == 0,
        "a detached buffer leaves its views empty");
  check(nts_view_bytes(tracking) == 0, "and with no bytes to read");
  check(nts_view_byte_offset(cut) == 0,
        "and reporting a zero offset rather than a stale one");
  nts_release((NtsHeader *)moved);
  nts_release((NtsHeader *)cut);
  nts_release((NtsHeader *)tracking);
  nts_release((NtsHeader *)buffer);
}

int main(void) {
  every_kind_narrows_the_way_node_does();
  copy_within_reads_what_it_has_written();
  set_between_kinds_converts_values();
  a_view_is_a_window_and_a_slice_is_not();
  a_tracking_length_follows_its_buffer();
  return failures != 0;
}
