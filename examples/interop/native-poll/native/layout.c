// This translation unit deliberately does not include generated program.h.
// It asks the platform header independently of the TS-authored declaration.
#include <poll.h>
#include <stddef.h>

size_t pollfd_size(void) { return sizeof(struct pollfd); }
size_t pollfd_alignment(void) { return _Alignof(struct pollfd); }
size_t pollfd_fd(void) { return offsetof(struct pollfd, fd); }
size_t pollfd_events(void) { return offsetof(struct pollfd, events); }
size_t pollfd_revents(void) { return offsetof(struct pollfd, revents); }
