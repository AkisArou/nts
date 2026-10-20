#ifndef NTS_RESOURCE_ATOMS_H
#define NTS_RESOURCE_ATOMS_H
#include <stdint.h>
int accept_name(const uint16_t *name);
// ENUMRESLANGPROCW's atom-carrying half: either pointer may be an atom.
typedef int (*name_proc)(const uint16_t *type, const uint16_t *name,
                         uint16_t language, int64_t parameter);
int enumerate_names(name_proc proc, int64_t parameter);
#endif
