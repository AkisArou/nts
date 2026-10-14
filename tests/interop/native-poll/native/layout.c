// The numbers `caller.c` prints, read from the real <poll.h>. A runtime
// report, not a check: `native_witness.c` is the check, compiled on its own
// beside this file, and it asserts the field *types* as well -- size,
// alignment and offsets are identical whether `events` is signed or unsigned,
// so they pass a schema that is wrong about every value read through it.
#include <poll.h>
#include <stddef.h>
size_t pollfd_size(void) { return sizeof(struct pollfd); }
size_t pollfd_alignment(void) { return _Alignof(struct pollfd); }
size_t pollfd_fd(void) { return offsetof(struct pollfd, fd); }
size_t pollfd_events(void) { return offsetof(struct pollfd, events); }
size_t pollfd_revents(void) { return offsetof(struct pollfd, revents); }
