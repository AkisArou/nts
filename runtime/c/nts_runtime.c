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

/* Allocated and reclaimed, so that a test can see reference counting balance
 * from inside the program rather than infer it from memory use. */
static size_t nts_allocated = 0;
static size_t nts_reclaimed = 0;

size_t nts_live_count(void) { return nts_allocated - nts_reclaimed; }

const NtsDescriptor nts_desc_ref = {NTS_KIND_ARRAY, sizeof(void *), 1, 0, "reference"};
const NtsDescriptor nts_desc_string1 = {NTS_KIND_STRING, 1, 0, 0, "string"};
const NtsDescriptor nts_desc_string2 = {NTS_KIND_STRING, 2, 0, 0, "string"};

/* The NoGC provider (RFC 9.1): a bump allocator that never frees. For compiler
 * bring-up, allocation testing and bounded-lifetime tools. It must never be
 * selected silently for a general application. */
#ifndef NTS_PROVIDER_RC
static unsigned char *nts_bump = 0;
static size_t nts_bump_left = 0;
#endif

static size_t nts_bytes_held = 0;

size_t nts_live_bytes(void) { return nts_bytes_held; }

void *nts_alloc(size_t bytes) {
    bytes = (bytes + 15u) & ~(size_t)15u;
    nts_bytes_held += bytes;

#ifdef NTS_PROVIDER_RC
    /* Its own allocation, because it will be given back. The size is kept in
     * front of the object so that `nts_free` knows what it is returning without
     * consulting the descriptor -- which a freed object may no longer have. */
    size_t *block = (size_t *)malloc(bytes + 16u);
    if (!block) {
        fprintf(stderr, "nts: out of memory\n");
        abort();
    }
    *block = bytes;
    return (unsigned char *)block + 16u;
#else
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
#endif
}

/* Give an object's memory back. Only the reference-counting provider has
 * anything to give: under NoGC there is no per-object allocation to return, and
 * the last release is where a tracing collector would do nothing at all. */
static void nts_free(void *object) {
#ifdef NTS_PROVIDER_RC
    size_t *block = (size_t *)((unsigned char *)object - 16u);
    nts_bytes_held -= *block;
    free(block);
#else
    (void)object;
#endif
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
    /* One reference: the caller's. */
    object->reserved = 1;
    nts_allocated++;
    return object;
}

/* Reference counting (RFC 9.2). The count lives in the header's
 * provider-reserved word, which is unused under NoGC and is this under RC.
 *
 * Not atomic. A runtime owns its heap (RFC 17.1) and a managed reference does
 * not cross between runtimes, so the count is only ever touched by one thread.
 * Making it atomic would cost every retain a locked instruction to defend
 * against sharing the design does not permit. */
void nts_retain(NtsHeader *object) {
    if (!object || object->reserved == NTS_IMMORTAL) {
        return;
    }
    object->reserved++;
}

/* Give up what a dying object was holding.
 *
 * A field is a slot with an owner, so an object that is about to stop existing
 * has to release everything its slots hold -- otherwise a tree of objects leaks
 * everything below its root, which is the shape of leak that looks like it
 * works right up until it doesn't. */
static void nts_release_contents(NtsHeader *object) {
    const NtsDescriptor *descriptor = object->descriptor;
    if (descriptor->references == 0) {
        return;
    }
    if (descriptor->kind == NTS_KIND_ARRAY) {
        NtsHeader **slots = NTS_ELEMENTS(object, NtsHeader *);
        for (uint32_t index = 0; index < object->length; index++) {
            nts_release(slots[index]);
        }
        return;
    }
    for (uint32_t index = 0; index < descriptor->references; index++) {
        unsigned char *slot = (unsigned char *)object + descriptor->offsets[index];
        nts_release(*(NtsHeader **)slot);
    }
}

/* Objects whose count has reached zero and whose contents have not been given
 * up yet, linked through the count word -- which is free, because the count is
 * zero and the object is going away.
 *
 * Threading the list through the objects is what makes destruction iterative
 * rather than recursive, and that is not a micro-optimization: releasing the
 * head of a million-node list recursively is a million C stack frames. It also
 * means destruction allocates nothing and so cannot fail. */
static NtsHeader *nts_dying = 0;
static bool nts_draining = false;

void nts_release(NtsHeader *object) {
    if (!object || object->reserved == NTS_IMMORTAL) {
        return;
    }
    if (object->reserved > 1) {
        object->reserved--;
        return;
    }

    /* The last reference. A cycle collector (RFC 9.2) will record candidates
     * here too, since a cycle is precisely what never reaches this line. */
    object->reserved = (uintptr_t)nts_dying;
    nts_dying = object;
    if (nts_draining) {
        /* An outer call owns the list and will get to it. */
        return;
    }

    nts_draining = true;
    while (nts_dying) {
        NtsHeader *dead = nts_dying;
        nts_dying = (NtsHeader *)dead->reserved;
        /* This may link more objects into the list, which the loop picks up. */
        nts_release_contents(dead);
        nts_reclaimed++;
        nts_free(dead);
    }
    nts_draining = false;
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
    array->reserved = 1;
    nts_allocated++;
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
    out->reserved = 1;
    nts_allocated++;
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
