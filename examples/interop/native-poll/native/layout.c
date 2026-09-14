// This translation unit deliberately does not include generated program.h.
// It asks the platform header independently of the TS-authored declaration.
#include <poll.h>
#include <stdint.h>
#include <stddef.h>

// Everything nts believes about `struct pollfd` and `poll`, checked here
// against the real declarations. Generated, so it covers every field and the
// prototype rather than the handful of numbers a person thought to compare --
// and so it cannot fall behind the binding it describes.
//
// The numbers below are the weaker half. Size, alignment and offsets are
// identical whether `events` is signed or unsigned, so they pass a schema that
// is wrong about every value read through it; the generated file also asserts
// each field's exact type and the exact prototype.
#include "native_witness.h"

size_t pollfd_size(void) { return sizeof(struct pollfd); }
size_t pollfd_alignment(void) { return _Alignof(struct pollfd); }
size_t pollfd_fd(void) { return offsetof(struct pollfd, fd); }
size_t pollfd_events(void) { return offsetof(struct pollfd, events); }
size_t pollfd_revents(void) { return offsetof(struct pollfd, revents); }
