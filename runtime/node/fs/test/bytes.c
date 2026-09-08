/* The `_bytes` path family, against the string family it must never drift from.
 *
 * Eleven of these were added on 2026-09-08, each written as a thin wrapper over
 * a shared `*_native_path` helper precisely so the two forms could not disagree.
 * That is a claim about the code's shape; this is the check. Nothing had run
 * either form, because `fs` does not compile.
 *
 * Every test here asks one question: given a path, does the byte form answer
 * what the string form answers? Node's own suite cannot ask it. Upstream there
 * is one implementation that takes a Buffer or a string and normalises at the
 * top, so there is no second answer for a test to disagree with -- the drift
 * this guards against is not a bug node could have, which is exactly why it is
 * worth writing here.
 *
 * And then the case that is the whole reason byte paths exist at all: a
 * filename that is not valid UTF-8. The string form cannot even be *asked* the
 * question, so the byte form is the only way to reach such a file -- and it is
 * the one path where a wrapper that quietly went through a string would lose.
 */
#if defined(__linux__) && !defined(_GNU_SOURCE)
#define _GNU_SOURCE
#endif

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include "fs.h"
#include "../internal/shared.h"

const uint32_t nts_closure_call_slot = 0;

static int failures;
static char root[512];

static void expect_true(const char *what, bool ok) {
  if (!ok) {
    printf("FAIL %s\n", what);
    failures++;
  } else {
    printf("ok   %s\n", what);
  }
}

static NtsString *str(const char *value) {
  return nts_string_from_utf8(value, strlen(value));
}

/* The same shape `fs.c`'s own `native_bytes` builds, so the test feeds the
 * bindings what the compiled TypeScript would feed them. */
static NtsArray *bytes_of(const char *value, size_t length) {
  NtsArray *bytes = nts_array_new(&nts_node_desc_double, (double)length);
  double *items = NTS_ITEMS(bytes, double);
  for (size_t i = 0; i < length; i++) {
    items[i] = (double)(unsigned char)value[i];
  }
  return bytes;
}

static NtsArray *bytes_of_str(const char *value) {
  return bytes_of(value, strlen(value));
}

static bool same_columns(NtsArray *a, NtsArray *b) {
  if (a == NULL || b == NULL) return a == b;
  if (a->header.length != b->header.length) return false;
  const double *x = NTS_ITEMS(a, double);
  const double *y = NTS_ITEMS(b, double);
  for (uint32_t i = 0; i < a->header.length; i++) {
    /* Column 10 is the access time, which a `stat` between the two calls can
     * legitimately move. Every other column is a fact about the file. */
    if (i == 10) continue;
    if (x[i] != y[i]) return false;
  }
  return true;
}

static void path_in(char *out, size_t size, const char *leaf) {
  snprintf(out, size, "%s/%s", root, leaf);
}

static void stat_agrees_between_the_two_forms(void) {
  char file[600];
  path_in(file, sizeof file, "plain.txt");
  FILE *handle = fopen(file, "w");
  fputs("hello", handle);
  fclose(handle);

  NtsArray *from_string = nts_fs_stat(str(file), true);
  NtsArray *from_bytes = nts_fs_stat_bytes(bytes_of_str(file), true);
  expect_true("stat agrees between the two forms",
              same_columns(from_string, from_bytes));
}

static void access_agrees_between_the_two_forms(void) {
  char file[600], missing[600];
  path_in(file, sizeof file, "plain.txt");
  path_in(missing, sizeof missing, "not-here.txt");

  expect_true("access agrees on a file that exists",
              nts_fs_access(str(file), 0.0) ==
                  nts_fs_access_bytes(bytes_of_str(file), 0.0));
  /* The failing direction matters as much as the passing one: a wrapper that
   * returned a different errno for a missing file would send the TypeScript
   * down a different branch and throw the wrong error class. */
  expect_true("access agrees on a file that does not",
              nts_fs_access(str(missing), 0.0) ==
                  nts_fs_access_bytes(bytes_of_str(missing), 0.0));
}

static void mkdir_and_unlink_agree_between_the_two_forms(void) {
  char by_string[600], by_bytes[600];
  path_in(by_string, sizeof by_string, "made-by-string");
  path_in(by_bytes, sizeof by_bytes, "made-by-bytes");

  double a = nts_fs_mkdir(str(by_string), 511.0);
  double b = nts_fs_mkdir_bytes(bytes_of_str(by_bytes), 511.0);
  expect_true("mkdir agrees between the two forms", a == b && a == 0.0);

  /* Making the same directory twice is the interesting half: both forms have
   * to produce EEXIST rather than one of them succeeding. */
  double again_string = nts_fs_mkdir(str(by_string), 511.0);
  double again_bytes = nts_fs_mkdir_bytes(bytes_of_str(by_bytes), 511.0);
  expect_true("mkdir agrees when the directory is already there",
              again_string == again_bytes && again_string != 0.0);

  expect_true("unlink agrees on something that is not a file",
              nts_fs_unlink(str(by_string)) ==
                  nts_fs_unlink_bytes(bytes_of_str(by_bytes)));
}

static void realpath_agrees_between_the_two_forms(void) {
  char file[600];
  path_in(file, sizeof file, "plain.txt");
  NtsString *from_string = nts_fs_realpath(str(file));
  NtsArray *from_bytes = nts_fs_realpath_bytes(bytes_of_str(file));
  if (from_string == NULL || from_bytes == NULL) {
    expect_true("realpath agrees between the two forms", false);
    return;
  }
  /* Same answer, two representations: the byte form must be the UTF-8 of the
   * string form, byte for byte, not a re-encoding of it. */
  size_t length = 0;
  char *utf8 = nts_node_to_utf8_alloc(from_string, &length);
  bool same = utf8 != NULL && from_bytes->header.length == length;
  if (same) {
    const double *items = NTS_ITEMS(from_bytes, double);
    for (uint32_t i = 0; i < from_bytes->header.length && same; i++) {
      same = items[i] == (double)(unsigned char)utf8[i];
    }
  }
  free(utf8);
  expect_true("realpath agrees between the two forms", same);
}

static void a_path_that_is_not_utf8_is_reachable_only_by_bytes(void) {
  /* 0xff is not a legal UTF-8 lead byte, so this filename has no string
   * spelling at all. Linux does not care -- a filename is bytes -- and node
   * reaches such a file with a Buffer path. If the byte bindings went through
   * a string anywhere, this is where it shows. */
  char leaf[8] = {'b', 'a', 'd', '-', (char)0xff, '\0'};
  char file[600];
  path_in(file, sizeof file, leaf);

  FILE *handle = fopen(file, "w");
  if (handle == NULL) {
    expect_true("a non-UTF-8 path can be created at all", false);
    return;
  }
  fputs("x", handle);
  fclose(handle);

  NtsArray *columns = nts_fs_stat_bytes(bytes_of(file, strlen(file)), true);
  expect_true("a path that is not UTF-8 can be stat'd by bytes",
              columns != NULL && columns->header.length > 0);

  expect_true("a path that is not UTF-8 is accessible by bytes",
              nts_fs_access_bytes(bytes_of(file, strlen(file)), 0.0) == 0.0);

  /* And the file really is the one with the odd name: scandir must list a leaf
   * whose bytes include 0xff, which a string round trip would have replaced
   * with U+FFFD. */
  NtsArray *entries = nts_fs_scandir_bytes(bytes_of_str(root));
  bool found = false;
  if (entries != NULL) {
    void **items = NTS_ITEMS(entries, void *);
    for (uint32_t i = 0; i < entries->header.length && !found; i++) {
      NtsArray *name = (NtsArray *)items[i];
      if (name == NULL || name->header.length == 0) continue;
      const double *chars = NTS_ITEMS(name, double);
      for (uint32_t j = 0; j < name->header.length; j++) {
        if (chars[j] == 255.0) found = true;
      }
    }
  }
  expect_true("scandir by bytes preserves a byte no string could hold", found);
}

int main(void) {
  snprintf(root, sizeof root, "%s/nts-fs-bytes-XXXXXX",
           getenv("TMPDIR") ? getenv("TMPDIR") : "/tmp");
  if (mkdtemp(root) == NULL) {
    printf("could not make a temporary directory\n");
    return 2;
  }

  stat_agrees_between_the_two_forms();
  access_agrees_between_the_two_forms();
  mkdir_and_unlink_agree_between_the_two_forms();
  realpath_agrees_between_the_two_forms();
  a_path_that_is_not_utf8_is_reachable_only_by_bytes();

  if (failures) {
    printf("%d failure(s)\n", failures);
    printf("(left %s in place for inspection)\n", root);
    return 1;
  }
  printf("all fs byte-path checks agree with the string family\n");
  return 0;
}
