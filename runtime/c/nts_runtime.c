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

/* Cyclic, because one descriptor serves every array of references and says
   nothing about what the elements point at. */
const NtsDescriptor nts_desc_ref = {NTS_KIND_ARRAY, sizeof(void *), 1, 1, 0, "reference"};
const NtsDescriptor nts_desc_string1 = {NTS_KIND_STRING, 1, 0, 0, 0, "string"};
const NtsDescriptor nts_desc_string2 = {NTS_KIND_STRING, 2, 0, 0, 0, "string"};

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
    /* A reference was added, so this is reachable from somewhere and is not a
     * candidate for anything. */
    object->flags = (object->flags & ~NTS_COLOR_MASK) | NTS_BLACK;
}

/* Every reference an object holds, handed one at a time to `visit`.
 *
 * The three walks the collector does and the one destruction does differ only
 * in what they do with each child, so the walking is written once. */
static void nts_each_reference(NtsHeader *object, void (*visit)(NtsHeader *)) {
    const NtsDescriptor *descriptor = object->descriptor;
    if (descriptor->references == 0) {
        return;
    }
    if (descriptor->kind == NTS_KIND_ARRAY) {
        NtsHeader **slots = NTS_ELEMENTS(object, NtsHeader *);
        for (uint32_t index = 0; index < object->length; index++) {
            if (slots[index]) {
                visit(slots[index]);
            }
        }
        return;
    }
    for (uint32_t index = 0; index < descriptor->references; index++) {
        unsigned char *slot = (unsigned char *)object + descriptor->offsets[index];
        NtsHeader *child = *(NtsHeader **)slot;
        if (child) {
            visit(child);
        }
    }
}

/* Give up what a dying object was holding.
 *
 * A field is a slot with an owner, so an object that is about to stop existing
 * has to release everything its slots hold -- otherwise a tree of objects leaks
 * everything below its root, which is the shape of leak that looks like it
 * works right up until it doesn't. */
static void nts_release_contents(NtsHeader *object) {
    nts_each_reference(object, nts_release);
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

/* Destroy an object whose count has reached zero: give up what it holds, then
 * give the memory back. */
static void nts_destroy(NtsHeader *object) {
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

/* --- The cycle collector (RFC 9.2) -----------------------------------------
 *
 * Reference counting reclaims everything the moment it becomes garbage, except
 * a cycle: every object in one is held by another object in the same one, so no
 * count reaches zero and the last release never happens. It takes one line of
 * TypeScript to build (`this.next = this`), so this is not a hypothetical.
 *
 * Trial deletion, after Bacon and Rajan. A release that does *not* reach zero
 * might have removed the last reference from outside a cycle, so the object
 * becomes a candidate. Collection then asks, of the subgraph reachable from the
 * candidates: if every reference that comes from inside this subgraph were
 * removed, would anything still be referenced? Whatever would not is garbage,
 * and the counts are put back for whatever would.
 *
 * Two things keep this off programs that do not need it. A type that cannot
 * lead back to itself can never be in a cycle, and the compiler works out which
 * those are, so most releases never buffer anything at all. And an object whose
 * count reaches zero is reclaimed by counting as before -- the collector only
 * ever sees what counting could not.
 *
 * The traversals are iterative. The recursive form is what the paper gives and
 * what is easiest to read, but its depth is the depth of the object graph, and
 * a long list reachable from one candidate would be a C stack frame per link. */

/* Candidate roots, and the shared worklist the traversals run on. */
static NtsHeader **nts_roots = 0;
static size_t nts_roots_len = 0;
static size_t nts_roots_cap = 0;
static NtsHeader **nts_work = 0;
static size_t nts_work_len = 0;
static size_t nts_work_cap = 0;
static size_t nts_candidates = 0;
static bool nts_collecting = false;

/* Collection runs when this many candidates have accumulated. Any threshold is
 * a guess; what it trades is promptness against how often the walk happens, and
 * a program that wants to decide for itself calls `nts_collect_cycles`. */
#define NTS_COLLECT_THRESHOLD 10000u

static void nts_push(NtsHeader ***buffer, size_t *len, size_t *cap, NtsHeader *object) {
    if (*len == *cap) {
        size_t grown = *cap ? *cap * 2u : 64u;
        NtsHeader **moved = (NtsHeader **)realloc(*buffer, grown * sizeof(NtsHeader *));
        if (!moved) {
            fprintf(stderr, "nts: out of memory collecting cycles\n");
            abort();
        }
        *buffer = moved;
        *cap = grown;
    }
    (*buffer)[(*len)++] = object;
}

static void nts_work_push(NtsHeader *object) {
    nts_push(&nts_work, &nts_work_len, &nts_work_cap, object);
}

static uint32_t nts_color(const NtsHeader *object) {
    return object->flags & NTS_COLOR_MASK;
}

static void nts_paint(NtsHeader *object, uint32_t color) {
    object->flags = (object->flags & ~NTS_COLOR_MASK) | color;
}

/* A release that did not reach zero. It might have cut the last reference from
 * outside a cycle, so the object is worth looking at later -- unless its type
 * cannot lead back to itself, in which case there is nothing to look for. */
static void nts_possible_root(NtsHeader *object) {
    if (!object->descriptor->cyclic || nts_color(object) == NTS_PURPLE) {
        return;
    }
    nts_paint(object, NTS_PURPLE);
    if (object->flags & NTS_BUFFERED) {
        return;
    }
    object->flags |= NTS_BUFFERED;
    nts_push(&nts_roots, &nts_roots_len, &nts_roots_cap, object);
    nts_candidates++;
}

void nts_release(NtsHeader *object) {
    if (!object || object->reserved == NTS_IMMORTAL) {
        return;
    }
    if (object->reserved > 1) {
        object->reserved--;
        nts_possible_root(object);
        /* Not while destroying: the dying list keeps its next pointer in the
         * count word, so an object on it has no count for the collector to
         * read. */
        if (!nts_draining && !nts_collecting && nts_roots_len >= NTS_COLLECT_THRESHOLD) {
            nts_collect_cycles();
        }
        return;
    }

    object->reserved = 0;
    nts_paint(object, NTS_BLACK);
    if (object->flags & NTS_BUFFERED) {
        /* The candidate buffer is holding it. Freeing it now would leave the
         * buffer pointing at memory that is gone; collection frees it instead,
         * which is where the buffer is emptied. */
        return;
    }
    nts_destroy(object);
}

/* Remove, from the subgraph reachable from the candidates, every reference that
 * comes from inside it. What is left counted is referenced from outside. */
static void nts_mark_gray_child(NtsHeader *child) {
    if (child->reserved != NTS_IMMORTAL) {
        child->reserved--;
    }
    nts_work_push(child);
}

static void nts_mark_gray(NtsHeader *root) {
    nts_work_len = 0;
    nts_work_push(root);
    while (nts_work_len) {
        NtsHeader *object = nts_work[--nts_work_len];
        if (nts_color(object) == NTS_GRAY || object->reserved == NTS_IMMORTAL) {
            continue;
        }
        nts_paint(object, NTS_GRAY);
        nts_each_reference(object, nts_mark_gray_child);
    }
}

/* Put the counts back for everything that turned out to be referenced from
 * outside, and for everything reachable from it. */
static void nts_scan_black_child(NtsHeader *child) {
    if (child->reserved != NTS_IMMORTAL) {
        child->reserved++;
    }
    if (nts_color(child) != NTS_BLACK) {
        nts_paint(child, NTS_BLACK);
        nts_work_push(child);
    }
}

static void nts_scan_black(NtsHeader *root) {
    /* Runs inside `nts_scan`'s loop, so it uses the tail of the same worklist
     * rather than clearing it. */
    size_t floor = nts_work_len;
    nts_paint(root, NTS_BLACK);
    nts_work_push(root);
    while (nts_work_len > floor) {
        NtsHeader *object = nts_work[--nts_work_len];
        nts_each_reference(object, nts_scan_black_child);
    }
}

static void nts_scan_child(NtsHeader *child) {
    nts_work_push(child);
}

static void nts_scan(NtsHeader *root) {
    nts_work_len = 0;
    nts_work_push(root);
    while (nts_work_len) {
        NtsHeader *object = nts_work[--nts_work_len];
        if (nts_color(object) != NTS_GRAY) {
            continue;
        }
        if (object->reserved > 0 && object->reserved != NTS_IMMORTAL) {
            /* Still referenced from outside the subgraph: alive, and so is
             * everything it can reach. */
            nts_scan_black(object);
            continue;
        }
        nts_paint(object, NTS_WHITE);
        nts_each_reference(object, nts_scan_child);
    }
}

/* Gather what is left white: referenced only from within the subgraph, which is
 * the definition of a garbage cycle.
 *
 * Gather, not free. Freeing during the walk is the obvious thing and it is
 * wrong: two objects in a cycle point at each other, so after the first is
 * freed the second still names it, and the walk reads a color out of memory
 * that is gone. The recursive form the paper gives frees *after* recursing,
 * which has the same effect; a worklist has to say so. */
static NtsHeader **nts_dead = 0;
static size_t nts_dead_len = 0;
static size_t nts_dead_cap = 0;

static void nts_collect_white_child(NtsHeader *child) {
    nts_work_push(child);
}

static void nts_gather_white(NtsHeader *root) {
    nts_work_len = 0;
    nts_work_push(root);
    while (nts_work_len) {
        NtsHeader *object = nts_work[--nts_work_len];
        if (nts_color(object) != NTS_WHITE || (object->flags & NTS_BUFFERED)) {
            continue;
        }
        nts_paint(object, NTS_BLACK);
        nts_each_reference(object, nts_collect_white_child);
        nts_push(&nts_dead, &nts_dead_len, &nts_dead_cap, object);
    }
}

void nts_collect_cycles(void) {
    if (nts_collecting) {
        return;
    }
    nts_collecting = true;

    /* Mark. A candidate that is no longer purple was retained since it was
     * buffered, so it is reachable and not a root; one whose count reached zero
     * while buffered was left for exactly this moment. */
    size_t kept = 0;
    for (size_t index = 0; index < nts_roots_len; index++) {
        NtsHeader *root = nts_roots[index];
        if (nts_color(root) == NTS_PURPLE && root->reserved > 0
            && root->reserved != NTS_IMMORTAL) {
            nts_mark_gray(root);
            nts_roots[kept++] = root;
            continue;
        }
        root->flags &= ~NTS_BUFFERED;
        if (nts_color(root) == NTS_BLACK && root->reserved == 0) {
            nts_destroy(root);
        }
    }
    nts_roots_len = kept;

    for (size_t index = 0; index < nts_roots_len; index++) {
        nts_scan(nts_roots[index]);
    }

    /* Collect. The buffered flag is cleared first for every root, because
     * `nts_collect_white` refuses to free anything still buffered -- which is
     * how a root that is white but still in the buffer stays reachable until
     * its own turn. */
    for (size_t index = 0; index < nts_roots_len; index++) {
        nts_roots[index]->flags &= ~NTS_BUFFERED;
    }
    nts_dead_len = 0;
    for (size_t index = 0; index < nts_roots_len; index++) {
        nts_gather_white(nts_roots[index]);
    }
    nts_roots_len = 0;

    /* Every one of these is garbage and every reference between them has
     * already been accounted for, so this frees the memory and nothing else --
     * releasing contents here would decrement counts a second time. */
    for (size_t index = 0; index < nts_dead_len; index++) {
        nts_reclaimed++;
        nts_free(nts_dead[index]);
    }
    nts_dead_len = 0;
    nts_collecting = false;
}

size_t nts_cycle_candidates(void) {
    return nts_candidates;
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

/* Allocate a string of `length` code units, narrow if every unit fits a byte.
 *
 * The two representations are not a detail a caller should reproduce: a slice of
 * a wide string can be entirely narrow, and storing it wide would make an
 * equality test between it and a narrow literal take the slow path forever. */
static NtsString *nts_str_alloc(const uint16_t *units, uint32_t length) {
    int wide = 0;
    for (uint32_t at = 0; at < length; at++) {
        if (units[at] > 0xFFu) {
            wide = 1;
            break;
        }
    }
    size_t width = wide ? 2u : 1u;
    NtsString *out =
        (NtsString *)nts_alloc(sizeof(NtsHeader) + ((size_t)length + 1) * width);
    out->descriptor = wide ? &nts_desc_string2 : &nts_desc_string1;
    out->reserved = 1;
    nts_allocated++;
    out->flags = wide ? NTS_TWO_BYTE : 0u;
    out->length = length;
    if (wide) {
        uint16_t *into = NTS_ELEMENTS(out, uint16_t);
        for (uint32_t at = 0; at < length; at++) {
            into[at] = units[at];
        }
        into[length] = 0;
    } else {
        unsigned char *into = NTS_ELEMENTS(out, unsigned char);
        for (uint32_t at = 0; at < length; at++) {
            into[at] = (unsigned char)units[at];
        }
        into[length] = 0;
    }
    return out;
}

/* Copy a range of code units out of a string. */
static NtsString *nts_str_range(const NtsString *s, uint32_t from, uint32_t to) {
    uint32_t length = to > from ? to - from : 0u;
    if (length == 0) {
        return nts_str_alloc(0, 0);
    }
    uint16_t *units = (uint16_t *)malloc((size_t)length * sizeof(uint16_t));
    if (!units) {
        fprintf(stderr, "nts: out of memory\n");
        abort();
    }
    for (uint32_t at = 0; at < length; at++) {
        units[at] = nts_unit(s, from + at);
    }
    NtsString *out = nts_str_alloc(units, length);
    free(units);
    return out;
}

/* `ToIntegerOrInfinity` then a clamp into `[0, length]`, with a negative index
 * counted from the end -- which is what makes `s.slice(-2)` the last two. */
static uint32_t nts_str_clamp(double index, uint32_t length, int relative) {
    index = nts_to_integer(index);
    if (relative && index < 0) {
        index += (double)length;
    }
    if (index < 0) {
        return 0u;
    }
    if (index >= (double)length) {
        return length;
    }
    return (uint32_t)index;
}

/* Where `needle` first occurs at or after `from`, or -1.
 *
 * The narrow-narrow case gets `memchr` and `memcmp`, which is not a
 * micro-optimization: both are vectorized in every C library worth using, and
 * the naive form -- a branch per code unit, through a function that has to ask
 * which width the string is -- was fourteen times more work than the loop this
 * benchmark was written to measure. Most strings in most programs are narrow,
 * so this is the path that runs. */
static double nts_str_find(const NtsString *s, const NtsString *needle, uint32_t from,
                           int backwards) {
    if (needle->length > s->length) {
        return -1.0;
    }
    uint32_t last = s->length - needle->length;

    const int both_narrow = ((s->flags | needle->flags) & NTS_TWO_BYTE) == 0;
    if (both_narrow && !backwards) {
        const unsigned char *text = NTS_ELEMENTS(s, unsigned char);
        const unsigned char *want = NTS_ELEMENTS(needle, unsigned char);
        if (needle->length == 0) {
            return (double)(from <= last ? from : last);
        }
        uint32_t at = from;
        while (at <= last) {
            const unsigned char *hit =
                (const unsigned char *)memchr(text + at, want[0], (size_t)(last - at) + 1u);
            if (!hit) {
                return -1.0;
            }
            at = (uint32_t)(hit - text);
            if (memcmp(hit, want, needle->length) == 0) {
                return (double)at;
            }
            at++;
        }
        return -1.0;
    }

    for (uint32_t start = 0; start <= last; start++) {
        uint32_t at = backwards ? last - start : start;
        if (!backwards && at < from) {
            continue;
        }
        uint32_t matched = 0;
        while (matched < needle->length
               && nts_unit(s, at + matched) == nts_unit(needle, matched)) {
            matched++;
        }
        if (matched == needle->length) {
            return (double)at;
        }
    }
    return -1.0;
}

double nts_str_code_point_at(const NtsString *s, double at) {
    at = nts_to_integer(at);
    double unit = nts_str_char_code_at(s, at);
    if (unit != unit) {
        return unit;
    }
    uint32_t index = (uint32_t)at;
    uint16_t lead = (uint16_t)unit;
    /* A surrogate pair is one code point spread over two units. */
    if (lead >= 0xD800u && lead <= 0xDBFFu && index + 1 < s->length) {
        uint16_t trail = nts_unit(s, index + 1);
        if (trail >= 0xDC00u && trail <= 0xDFFFu) {
            return (double)(0x10000u + ((lead - 0xD800u) << 10) + (trail - 0xDC00u));
        }
    }
    return unit;
}

double nts_str_index_of(const NtsString *s, const NtsString *needle) {
    return nts_str_find(s, needle, 0u, 0);
}

double nts_str_last_index_of(const NtsString *s, const NtsString *needle) {
    return nts_str_find(s, needle, 0u, 1);
}

bool nts_str_includes(const NtsString *s, const NtsString *needle) {
    return nts_str_find(s, needle, 0u, 0) >= 0.0;
}

bool nts_str_starts_with(const NtsString *s, const NtsString *needle) {
    if (needle->length > s->length) {
        return false;
    }
    for (uint32_t at = 0; at < needle->length; at++) {
        if (nts_unit(s, at) != nts_unit(needle, at)) {
            return false;
        }
    }
    return true;
}

bool nts_str_ends_with(const NtsString *s, const NtsString *needle) {
    if (needle->length > s->length) {
        return false;
    }
    uint32_t offset = s->length - needle->length;
    for (uint32_t at = 0; at < needle->length; at++) {
        if (nts_unit(s, offset + at) != nts_unit(needle, at)) {
            return false;
        }
    }
    return true;
}

NtsString *nts_str_char_at(const NtsString *s, double at) {
    at = nts_to_integer(at);
    if (at < 0 || at >= (double)s->length) {
        /* Out of range is the empty string, unlike `charCodeAt`'s NaN. */
        return nts_str_alloc(0, 0);
    }
    uint32_t index = (uint32_t)at;
    return nts_str_range(s, index, index + 1u);
}

NtsString *nts_str_repeat(const NtsString *s, double times) {
    if (times != times || times < 0) {
        times = 0;
    }
    times = floor(times);
    /* A repeat that cannot fit in a string's length is an allocation that would
     * fail anyway; refusing loudly beats a truncated answer. */
    if (times * (double)s->length > 4294967295.0) {
        fprintf(stderr, "nts: repeat produces a string longer than 2^32-1\n");
        abort();
    }
    uint32_t total = (uint32_t)(times * (double)s->length);
    if (total == 0) {
        return nts_str_alloc(0, 0);
    }
    uint16_t *units = (uint16_t *)malloc((size_t)total * sizeof(uint16_t));
    if (!units) {
        fprintf(stderr, "nts: out of memory\n");
        abort();
    }
    for (uint32_t at = 0; at < total; at++) {
        units[at] = nts_unit(s, at % s->length);
    }
    NtsString *out = nts_str_alloc(units, total);
    free(units);
    return out;
}

NtsString *nts_str_slice(const NtsString *s, double from, double to) {
    /* Negative counts from the end, which is what distinguishes `slice` from
     * `substring`. */
    uint32_t start = nts_str_clamp(from, s->length, 1);
    uint32_t end = nts_str_clamp(to, s->length, 1);
    return nts_str_range(s, start, end);
}

NtsString *nts_str_substring(const NtsString *s, double from, double to) {
    /* Negative clamps to zero and the two ends swap if they are out of order,
     * which is what distinguishes `substring` from `slice`. */
    uint32_t start = nts_str_clamp(from, s->length, 0);
    uint32_t end = nts_str_clamp(to, s->length, 0);
    if (start > end) {
        uint32_t swap = start;
        start = end;
        end = swap;
    }
    return nts_str_range(s, start, end);
}

NtsString *nts_string_from_utf8(const char *bytes, size_t length) {
    /* At most one code unit per byte for the BMP, two for a supplementary
     * character -- which is also at most one per byte, since those take four. */
    uint16_t *units = (uint16_t *)malloc((length + 1u) * sizeof(uint16_t));
    if (!units) {
        fprintf(stderr, "nts: out of memory\n");
        abort();
    }
    uint32_t count = 0;
    size_t at = 0;
    while (at < length) {
        unsigned char lead = (unsigned char)bytes[at];
        uint32_t point;
        size_t extra;
        if (lead < 0x80u) {
            point = lead;
            extra = 0;
        } else if ((lead & 0xE0u) == 0xC0u) {
            point = lead & 0x1Fu;
            extra = 1;
        } else if ((lead & 0xF0u) == 0xE0u) {
            point = lead & 0x0Fu;
            extra = 2;
        } else if ((lead & 0xF8u) == 0xF0u) {
            point = lead & 0x07u;
            extra = 3;
        } else {
            point = 0xFFFDu;
            extra = 0;
        }
        if (at + extra >= length + (extra == 0 ? 1u : 0u) && extra > 0) {
            point = 0xFFFDu;
            extra = 0;
        }
        for (size_t step = 1; step <= extra; step++) {
            unsigned char next = (unsigned char)bytes[at + step];
            if ((next & 0xC0u) != 0x80u) {
                point = 0xFFFDu;
                extra = 0;
                break;
            }
            point = (point << 6) | (next & 0x3Fu);
        }
        at += extra + 1u;

        if (point > 0xFFFFu) {
            /* A supplementary character is a surrogate pair, and `length`
             * counts both halves -- which is what JavaScript reports. */
            point -= 0x10000u;
            units[count++] = (uint16_t)(0xD800u + (point >> 10));
            units[count++] = (uint16_t)(0xDC00u + (point & 0x3FFu));
        } else {
            units[count++] = (uint16_t)point;
        }
    }
    NtsString *out = nts_str_alloc(units, count);
    free(units);
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
