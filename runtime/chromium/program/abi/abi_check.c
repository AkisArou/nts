/* The ABI's headers, each compiled as C on its own: the generated dom_idl.h
 * and the hand-written rest must stay C11 that a program's C can include,
 * whatever the C++ adapter that implements them needs. Nothing here runs.
 *
 * It is also what puts this directory on the include path of the program's
 * native witness, which `nts build` derives from the translation units a
 * `sources()` directory holds; a directory of headers alone contributes none
 * (reported to the compiler lane). */
#include "dom_abi.h"
#include "dom_host.h"
#include "dom_idl.h"

_Static_assert(sizeof(NtsStringView) == 16, "a string view is two words");
