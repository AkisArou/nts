/* The Native TypeScript C runtime: the half that allocates or is too large to
 * inline. See nts_runtime.h for why this is a translation unit rather than text
 * pasted into every generated file.
 *
 * The system headers a runtime needs -- <stdio.h>, <stdlib.h>, <string.h> --
 * are confined here. That is the point: a generated file no longer picks up the
 * hundreds of names they declare, so a TypeScript `function div()` no longer
 * collides with C's.
 */
#include "nts_runtime.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

const NtsDescriptor nts_desc_string1 = {NTS_KIND_STRING, 1, 0, "string"};
const NtsDescriptor nts_desc_string2 = {NTS_KIND_STRING, 2, 0, "string"};

/* The NoGC provider (RFC 9.1): a bump allocator that never frees. For compiler
 * bring-up, allocation testing and bounded-lifetime tools. It must never be
 * selected silently for a general application. */
static unsigned char *nts_bump = 0;
static size_t nts_bump_left = 0;

void *nts_alloc(size_t bytes) {
    bytes = (bytes + 15u) & ~(size_t)15u;
    if (bytes > nts_bump_left) {
        size_t chunk = bytes > (size_t)1048576 ? bytes : (size_t)1048576;
        nts_bump = (unsigned char *)malloc(chunk);
        if (!nts_bump) {
            fprintf(stderr, "nts: out of memory\n");
            abort();
        }
        nts_bump_left = chunk;
    }
    void *result = nts_bump;
    nts_bump += bytes;
    nts_bump_left -= bytes;
    return result;
}

/* A fixed-layout object: the descriptor knows its whole size, and `length` is
 * not a count of anything. Zeroed, so a field is never read before it is
 * written -- the compiler emits a store for every field of a literal, but a
 * partially-built object is observable through a call made in the middle of
 * one. */
NtsHeader *nts_object_new(const NtsDescriptor *descriptor) {
    NtsHeader *object = (NtsHeader *)nts_alloc(descriptor->size);
    memset(object, 0, descriptor->size);
    object->descriptor = descriptor;
    return object;
}

void nts_bounds(double index, uint32_t length) {
    fprintf(stderr, "nts: index %g is outside [0, %u)\n", index, length);
    abort();
}

NtsArray *nts_array_new(const NtsDescriptor *descriptor, double length) {
    if (!(length >= 0.0 && length <= 4294967295.0
          && length == (double)(uint32_t)length)) {
        fprintf(stderr, "nts: %g is not a valid array length\n", length);
        abort();
    }
    uint32_t count = (uint32_t)length;
    size_t bytes = sizeof(NtsHeader) + (size_t)count * descriptor->size;
    NtsArray *array = (NtsArray *)nts_alloc(bytes);
    array->descriptor = descriptor;
    array->reserved = 0;
    array->flags = 0;
    array->length = count;
    /* Zeroed rather than left as holes: there is no `undefined` in a double, so
     * a hole has no representation to leave behind. */
    memset((unsigned char *)array + sizeof(NtsHeader), 0,
           (size_t)count * descriptor->size);
    return array;
}

/* Copy a string into two-byte slots, whichever way it was stored. */
static void nts_widen(uint16_t *into, const NtsString *from) {
    if ((from->flags & NTS_TWO_BYTE) != 0) {
        memcpy(into, NTS_ELEMENTS(from, uint16_t), (size_t)from->length * 2u);
        return;
    }
    const unsigned char *units = NTS_ELEMENTS(from, unsigned char);
    for (uint32_t i = 0; i < from->length; i++) {
        into[i] = units[i];
    }
}

/* Concatenation is the only string operation that allocates. A literal does
 * not: it is immutable and known at compile time, so the compiler emits it as
 * static data and references it. */
NtsString *nts_concat(const NtsString *a, const NtsString *b) {
    uint32_t total = a->length + b->length;
    int wide = ((a->flags | b->flags) & NTS_TWO_BYTE) != 0;
    size_t width = wide ? 2u : 1u;
    /* One extra code unit, kept at zero, so a one-byte string can be handed to
     * C directly. */
    NtsString *out =
        (NtsString *)nts_alloc(sizeof(NtsHeader) + ((size_t)total + 1) * width);
    out->descriptor = wide ? &nts_desc_string2 : &nts_desc_string1;
    out->reserved = 0;
    out->flags = wide ? NTS_TWO_BYTE : 0u;
    out->length = total;
    if (wide) {
        uint16_t *into = NTS_ELEMENTS(out, uint16_t);
        nts_widen(into, a);
        nts_widen(into + a->length, b);
        into[total] = 0;
    } else {
        unsigned char *into = NTS_ELEMENTS(out, unsigned char);
        memcpy(into, NTS_ELEMENTS(a, unsigned char), a->length);
        memcpy(into + a->length, NTS_ELEMENTS(b, unsigned char), b->length);
        into[total] = 0;
    }
    return out;
}

/* Equality is by value, not by identity: `"a" + "b" === "ab"` is true in
 * JavaScript, and the two are different allocations. */
bool nts_string_eq(const NtsString *a, const NtsString *b) {
    if (a == b) {
        return true;
    }
    if (a->length != b->length) {
        return false;
    }
    int a_wide = (a->flags & NTS_TWO_BYTE) != 0;
    int b_wide = (b->flags & NTS_TWO_BYTE) != 0;
    if (a_wide == b_wide) {
        size_t width = a_wide ? 2u : 1u;
        return memcmp((const unsigned char *)a + sizeof(NtsHeader),
                      (const unsigned char *)b + sizeof(NtsHeader),
                      (size_t)a->length * width)
               == 0;
    }
    /* One of each: compare code unit by code unit rather than widening, so
     * equality never allocates. */
    const NtsString *narrow = a_wide ? b : a;
    const NtsString *wide = a_wide ? a : b;
    const unsigned char *narrow_units = NTS_ELEMENTS(narrow, unsigned char);
    const uint16_t *wide_units = NTS_ELEMENTS(wide, uint16_t);
    for (uint32_t i = 0; i < a->length; i++) {
        if ((uint16_t)narrow_units[i] != wide_units[i]) {
            return false;
        }
    }
    return true;
}
