/* Failure results and independent descriptor state, without a node shim. */
#define _XOPEN_SOURCE 700
#include "nts_runtime.h"
#include <assert.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

int main(void) {
  int saved_out = dup(1);
  int saved_err = dup(2);
  assert(saved_out >= 0 && saved_err >= 0);
  NtsString *text = nts_string_from_utf8("a\0b", 3);
  NtsString *empty = nts_string_from_utf8("", 0);

  /* Both descriptors share this file, so its bytes expose cross-stream order.
   */
  FILE *capture = tmpfile();
  assert(capture != NULL);
  assert(dup2(fileno(capture), 1) == 1 && dup2(fileno(capture), 2) == 2);
  NtsString *a = nts_string_from_utf8("a", 1);
  const uint16_t b_units[] = {'b', 0, 0x00e9, 0xd800, '\n'};
  NtsString *b = nts_str_alloc(b_units, 5);
  NtsString *c = nts_string_from_utf8("c", 1);
  NtsString *d = nts_string_from_utf8("d", 1);
  NtsString *e = nts_string_from_utf8("e\n", 2);
  NtsString *f = nts_string_from_utf8("f", 1);
  nts_console_write(a, false);
  assert(nts_write_stdout(b) == 0);
  nts_console_write(c, false);
  nts_console_write(d, true);
  assert(nts_write_stderr(e) == 0);
  nts_console_write(f, true);
  const char expected[] = "a\nb\0\xc3\xa9\xef\xbf\xbd\nc\nd\ne\nf\n";
  char actual[sizeof expected];
  rewind(capture);
  assert(fread(actual, 1, sizeof actual, capture) == sizeof expected - 1);
  assert(memcmp(actual, expected, sizeof expected - 1) == 0);
  assert(dup2(saved_out, 1) == 1 && dup2(saved_err, 2) == 2);
  assert(fclose(capture) == 0);
  nts_release((NtsHeader *)a);
  nts_release((NtsHeader *)b);
  nts_release((NtsHeader *)c);
  nts_release((NtsHeader *)d);
  nts_release((NtsHeader *)e);
  nts_release((NtsHeader *)f);

  /* A buffered write can succeed and its flush still fail. */
  assert(freopen("/dev/full", "w", stdout) != NULL);
  assert(nts_write_stdout(text) == -(double)ENOSPC);
  assert(freopen("/dev/null", "w", stdout) != NULL);
  assert(dup2(saved_out, 1) == 1);

  /* A fresh unbuffered stream fails inside fwrite instead. */
  assert(setvbuf(stdout, NULL, _IONBF, 0) == 0);
  assert(close(1) == 0);
  assert(nts_write_stdout(text) == -(double)EBADF);
  assert(!nts_stdout_is_tty());
  assert(dup2(saved_out, 1) == 1);
  clearerr(stdout);
  assert(nts_write_stdout(empty) == 0);

  assert(freopen("/dev/full", "w", stderr) != NULL);
  assert(nts_write_stderr(text) == -(double)ENOSPC);
  assert(freopen("/dev/null", "w", stderr) != NULL);
  assert(dup2(saved_err, 2) == 2);
  assert(nts_write_stderr(empty) == 0);

  /* Only one standard descriptor is attached to a terminal in each arm. */
  int master = posix_openpt(O_RDWR | O_NOCTTY);
  assert(master >= 0);
  assert(grantpt(master) == 0 && unlockpt(master) == 0);
  char *name = ptsname(master);
  assert(name != NULL);
  int terminal = open(name, O_RDWR | O_NOCTTY);
  int ordinary = open("/dev/null", O_WRONLY);
  assert(terminal >= 0 && ordinary >= 0);
  assert(dup2(terminal, 1) == 1 && dup2(ordinary, 2) == 2);
  assert(nts_stdout_is_tty() && !nts_stderr_is_tty());
  assert(dup2(ordinary, 1) == 1 && dup2(terminal, 2) == 2);
  assert(!nts_stdout_is_tty() && nts_stderr_is_tty());
  assert(dup2(saved_out, 1) == 1 && dup2(saved_err, 2) == 2);
  close(saved_out);
  close(saved_err);
  close(terminal);
  close(master);
  close(ordinary);
  nts_release((NtsHeader *)text);
  nts_release((NtsHeader *)empty);
#ifdef NTS_PROVIDER_RC
  assert(nts_live_count() == 0 && nts_live_bytes() == 0);
#endif
  puts("standard stream failure and descriptor checks passed");
  return 0;
}
