// A separately compiled C consumer. It supplies the path, asserts the flag and
// mode constants against the real macros, and then checks the file the
// compiled TypeScript created -- its contents and its permissions, which is
// the only way to tell that the third argument arrived at all.
#include <assert.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#include "program.h"

int main(void) {
  module__init();

  // The values the program spells as `CREATE_WRITE` and `OWNER_READ_WRITE`.
  // Macros, so no binding can carry them.
  assert((O_CREAT | O_WRONLY | O_TRUNC) == (64 | 1 | 512));
  assert(S_IRUSR == 0400 && S_IWUSR == 0200);

  char path[] = "/tmp/nts-native-open-example";
  unlink(path);

  double written = createAndWrite(path, 'k');
  printf("createAndWrite = %d\n", (int)written);
  assert(written == 1);

  // **The mode argument, checked by its effect.** A variadic call that dropped
  // the third argument still creates the file -- with whatever happened to be
  // in the register -- so the contents alone would not distinguish it. The
  // permission bits are what the argument decided.
  struct stat info;
  assert(stat(path, &info) == 0);
  printf("mode = 0%o\n", (unsigned)(info.st_mode & 07777));
  assert((info.st_mode & 07777) == 0600);

  char got = 0;
  int fd = open(path, O_RDONLY);
  assert(fd >= 0 && read(fd, &got, 1) == 1 && got == 'k');
  close(fd);

  // The same C function, called with no tail at all.
  assert(openExisting(path) == 0);
  assert(openExisting("/tmp/nts-native-open-absent") == -1);

  assert(remove(path) == 0);
  printf("native open: one variadic prototype, two arities\n");
  return 0;
}
