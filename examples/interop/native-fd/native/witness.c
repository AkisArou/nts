// This translation unit deliberately does not include generated program.h. It
// asks the platform header independently of the TS-authored declaration, and
// the generated witness compares the two: every field type and the exact
// prototype, not only sizes and offsets.
//
// `read` is the case that needs it. A binding declaring the buffer as
// `uint8_t *` typechecks, lowers without a diagnostic, and emits a prototype
// `program.c` accepts -- because `program.c` declares `read` itself and never
// sees <unistd.h>. Here it does, and refuses: `conflicting types for 'read'`.
#include <unistd.h>
#include <stdint.h>
#include <stddef.h>
#include "native_witness.h"
