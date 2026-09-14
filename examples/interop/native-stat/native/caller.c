// A separately compiled C consumer. It creates a file of a known size, calls
// `stat` itself through the real <sys/stat.h>, and compares every number the
// compiled TypeScript reports against its own — so both sides come from the
// platform and neither is a constant written here.
#define _GNU_SOURCE 1
#include <assert.h>
#include <fcntl.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#include "program.h"

int main(void) {
  // The layout the binding describes, asked of the real header. 144 bytes with
  // three nested `struct timespec`s is past what anyone transcribes correctly,
  // which is why this binding is generated.
  printf("stat: size=%zu align=%zu, st_size at %zu, st_mtim at %zu, reserved at %zu\n",
         sizeof(struct stat), _Alignof(struct stat), offsetof(struct stat, st_size),
         offsetof(struct stat, st_mtim), offsetof(struct stat, __glibc_reserved));
  assert(sizeof(struct stat) == 144);

  char path[] = "/tmp/nts-native-stat-example";
  unlink(path);
  int fd = open(path, O_CREAT | O_WRONLY | O_TRUNC, 0600);
  assert(fd >= 0);
  // Seventeen bytes, a number no padding or off-by-one offset produces.
  assert(write(fd, "seventeen bytes!!", 17) == 17);
  close(fd);

  struct stat mine;
  assert(stat(path, &mine) == 0);

  double size = sizeOf(path);
  printf("sizeOf = %d (C says %lld)\n", (int)size, (long long)mine.st_size);
  assert(size == (double)mine.st_size);

  // `st_mtim` is 88 bytes in, past three 64-bit members and two nested
  // structs. An offset wrong by one member lands in `st_ctim` or `st_blocks`
  // and disagrees with C.
  double seconds = modifiedSeconds(path);
  printf("modifiedSeconds = %lld (C says %lld)\n", (long long)seconds,
         (long long)mine.st_mtim.tv_sec);
  assert(seconds == (double)mine.st_mtim.tv_sec);

  double links = linkCount(path);
  printf("linkCount = %d (C says %lu)\n", (int)links, (unsigned long)mine.st_nlink);
  assert(links == (double)mine.st_nlink);

  unlink(path);
  printf("native stat: 144 bytes, three nested structs, all of it derived\n");
  return 0;
}
