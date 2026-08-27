/* The Native TypeScript C runtime.
 *
 * Real C, compiled as its own translation unit, rather than text pasted into
 * every generated file. Three things follow from that, and each was a problem
 * before:
 *
 *   - A generated file includes this header and <math.h>, and nothing else. It
 *     no longer picks up <stdlib.h>, which declares `div` -- so a TypeScript
 *     `function div()` no longer collides with the C library.
 *   - An external function nobody calls is not a warning, so the compiler no
 *     longer has to work out which helpers a program reaches in order to emit
 *     only those.
 *   - It can be read, edited and reviewed as C.
 *
 * What stays here rather than in the .c file is the small, hot half: a bounds
 * test that costs one comparison must not cost a call. `static inline` in C is
 * exempt from -Wunused-function, so an unused one is free.
 */
#ifndef NTS_RUNTIME_H
#define NTS_RUNTIME_H

#include <math.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

/* RFC 8.1: every managed object references an immutable descriptor, which
 * describes the shape rather than the contents -- so there is one per element
 * type, not one per object. */
/* Which shape the descriptor describes. A variable-length object reads `size`
 * as bytes per element and takes its count from the header; a fixed one reads
 * it as the whole object. Without the tag the same field would mean two things
 * and nothing would say which. */
#define NTS_KIND_ARRAY 0u
#define NTS_KIND_STRING 1u
#define NTS_KIND_OBJECT 2u

typedef struct NtsDescriptor {
    uint32_t kind;
    uint32_t size;
    /* RFC 8.3, the reference map. For an object, how many fields hold
     * references and where they are: `offsets` has `references` byte offsets
     * into the object, generated with `offsetof` so that the compiler that laid
     * the struct out is the one that says where its fields are.
     *
     * Byte offsets rather than a bitmap over field indices, because the runtime
     * cannot turn an index into an address: it does not know the field types.
     * A table also has no width limit, so an object with more than thirty-two
     * fields needs nothing special.
     *
     * For an array, `references` is 1 when the elements are references and 0
     * otherwise, and `offsets` is null -- element addresses are `i * size` and
     * there is no table worth writing down. A string has neither. */
    uint32_t references;
    /* Whether an object of this type could be part of a reference cycle -- that
     * is, whether the type can lead back to itself through reference fields.
     *
     * The compiler decides it, once per type, and it is what keeps the cycle
     * collector away from programs that have no cycles to collect. Without it a
     * candidate would be buffered on every release that does not reach zero,
     * which is most of them, and every allocating program would pay for a
     * hazard it does not have.
     *
     * Conservative in the safe direction: an array of references is cyclic
     * because one descriptor serves them all and says nothing about what the
     * elements point at, and a field whose type the compiler cannot see is
     * cyclic because unknown has to mean yes. */
    uint32_t cyclic;
    const uint32_t *offsets;
    const char *name;
} NtsDescriptor;

/* RFC 8.2. One header for every variable-length managed object: an array and a
 * string differ by descriptor, not by shape, so `length` is the same field at
 * the same offset for both.
 *
 * `reserved` is the provider-reserved word -- unused under NoGC, a reference
 * count under RC, a forwarding pointer under a moving collector. Not public
 * ABI. */
typedef struct NtsHeader {
    const NtsDescriptor *descriptor;
    uintptr_t reserved;
    uint32_t flags;
    uint32_t length;
} NtsHeader;

typedef NtsHeader NtsArray;
typedef NtsHeader NtsString;

#define NTS_ELEMENTS(a, T) ((T *)((unsigned char *)(a) + sizeof(NtsHeader)))

/* A string is a sequence of UTF-16 code units, which is what JavaScript means
 * by one: `length` counts them and `charCodeAt` indexes them. Storing UTF-8
 * would make both O(n) or wrong.
 *
 * Two representations rather than one, as V8 does: one byte per code unit when
 * every one is below 256, two bytes otherwise. `length` and indexing stay O(1)
 * for all of JavaScript, ordinary text costs one byte per character instead of
 * two, and a one-byte string is directly usable as a C string -- which matters,
 * because talking to C is the point. */
#define NTS_TWO_BYTE 1u

/* Elements of an array of references. Every reference is a pointer, so one
 * descriptor serves them all -- it describes the element's shape, not what the
 * element points at. `traced` is set, which is what a collector will read. */
extern const NtsDescriptor nts_desc_ref;
extern const NtsDescriptor nts_desc_string1;
extern const NtsDescriptor nts_desc_string2;

/* Colors for the cycle collector (RFC 9.2), in `flags`. A release that does not
 * reach zero *might* have removed the last reference from outside a cycle, so
 * the object becomes a candidate; the collector later works out which candidates
 * really are garbage by removing internal references and seeing what is left. */
#define NTS_COLOR_MASK 3u
#define NTS_BLACK 0u  /* In use. */
#define NTS_GRAY 1u   /* Internal references are being removed. */
#define NTS_WHITE 2u  /* Reachable only from within a cycle: garbage. */
#define NTS_PURPLE 3u /* A candidate root. */
#define NTS_BUFFERED 4u

/* Consider the candidates and reclaim whatever turns out to be garbage.
 *
 * Called automatically when candidates accumulate, and directly by a program
 * that would rather choose the moment. Reference counting reclaims everything
 * else the instant it becomes garbage; this is only for what it cannot. */
void nts_collect_cycles(void);

/* How many candidates have ever been buffered. For tests: an acyclic program
 * must never buffer one, and the only way to state that is to count. */
size_t nts_cycle_candidates(void);

/* An object the program did not allocate -- a string literal in static data --
 * carries this count and is never freed. A sentinel rather than a flag bit so
 * that retain and release need no branch beyond the one they already have. */
#define NTS_IMMORTAL UINT32_MAX

/* The memory provider is chosen at build time, and the runtime and the
 * generated program must agree about it -- so it is a define rather than
 * something either side decides for itself.
 *
 *   (default)          RFC 9.1 NoGC: a bump allocator, and nothing is freed.
 *   NTS_PROVIDER_RC    RFC 9.2: each object is its own allocation, and the last
 *                      release gives it back.
 *
 * NoGC is not slower for being simpler: a bump allocator is a pointer add, and
 * that is the point of it for allocation testing and microbenchmarks. RC pays
 * for a free list because it has something to give back. */
void *nts_alloc(size_t bytes);
size_t nts_live_bytes(void);
void nts_retain(NtsHeader *object);
/* How many allocated objects still hold a reference.
 *
 * Not a diagnostic afterthought: it is how reference counting is *tested*. A
 * program that allocates in a loop keeps this flat under RC and grows it
 * without bound under NoGC, and the difference is visible from inside the
 * program rather than inferred from its memory use. */
size_t nts_live_count(void);
void nts_release(NtsHeader *object);
NtsArray *nts_array_new(const NtsDescriptor *descriptor, double length);
NtsHeader *nts_object_new(const NtsDescriptor *descriptor);
void nts_bounds(double index, uint32_t length);
NtsString *nts_concat(const NtsString *a, const NtsString *b);
bool nts_string_eq(const NtsString *a, const NtsString *b);

/* One unsigned comparison catches a negative index too: it wraps to something
 * enormous, which is not less than the length. */
static inline uint32_t nts_check(const NtsArray *array, uint32_t index) {
    if (index >= array->length) {
        nts_bounds((double)index, array->length);
    }
    return index;
}

/* A double index must also be a whole number to name an element at all --
 * `xs[1.5]` is a property in JavaScript, not a slot. NaN fails the first
 * comparison. */
static inline uint32_t nts_index(const NtsArray *array, double index) {
    if (!(index >= 0.0 && index < (double)array->length
          && index == (double)(uint32_t)index)) {
        nts_bounds(index, array->length);
    }
    return (uint32_t)index;
}

/* JavaScript ToInt32: total, and wraps rather than trapping.
 *
 * The first branch is the case that actually happens. A double whose truncation
 * fits in int32 needs only truncating, which is one instruction; the general
 * path costs calls to trunc and fmod and is 2.6x slower. NaN fails both
 * comparisons and falls through to the isfinite check. */
static inline int32_t nts_to_int32(double x) {
    if (x > -2147483649.0 && x < 2147483648.0) {
        return (int32_t)x;
    }
    if (!isfinite(x)) {
        return 0;
    }
    double m = fmod(trunc(x), 4294967296.0);
    if (m < 0.0) {
        m += 4294967296.0;
    }
    return (int32_t)(uint32_t)m;
}

/* JavaScript ToUint32. As above; the fast path is the non-negative half of the
 * uint32 range. */
static inline uint32_t nts_to_uint32(double x) {
    if (x >= 0.0 && x < 4294967296.0) {
        return (uint32_t)x;
    }
    if (!isfinite(x)) {
        return 0;
    }
    double m = fmod(trunc(x), 4294967296.0);
    if (m < 0.0) {
        m += 4294967296.0;
    }
    return (uint32_t)m;
}

/* JavaScript `<<`: the count masks to five bits, and shifting a negative value
 * left is defined rather than undefined. */
static inline int32_t nts_shl(int32_t a, int32_t b) {
    return (int32_t)((uint32_t)a << ((uint32_t)b & 31u));
}

/* JavaScript `>>`: arithmetic, spelled so it does not depend on the
 * implementation's choice for a negative operand. */
static inline int32_t nts_shr(int32_t a, int32_t b) {
    uint32_t n = (uint32_t)b & 31u;
    if (a < 0) {
        return (int32_t)~(~(uint32_t)a >> n);
    }
    return (int32_t)((uint32_t)a >> n);
}

/* JavaScript `>>>`: logical, and the one bitwise result that is uint32 rather
 * than int32. */
static inline uint32_t nts_ushr(int32_t a, int32_t b) {
    return (uint32_t)a >> ((uint32_t)b & 31u);
}

/* JavaScript Math.round (ES 21.3.2.28), which is not C's round and is not
 * `floor(x + 0.5)` either.
 *
 * Three things it has to get right:
 *
 *   - A half goes toward *positive infinity*, not away from zero. C's
 *     round(-1.5) is -2; this is -1.
 *   - A value that is already an integer comes back unchanged. `floor(x + 0.5)`
 *     does not manage that near 2^53, where 0.5 is below the spacing between
 *     representable doubles: 9007199254740991 + 0.5 rounds to an even neighbour
 *     and the answer comes out one too small. Differential testing against node
 *     found it there.
 *   - Something in [-0.5, 0) rounds to *negative* zero, and `1 / -0` is not
 *     `1 / 0`, so the sign is observable and cannot be dropped. */
static inline double nts_round(double x) {
    if (!isfinite(x)) {
        return x;
    }
    const double lower = floor(x);
    if (lower == x) {
        /* Already an integer. Returning it rather than recomputing also keeps
         * the sign of a negative zero. */
        return x;
    }
    const double rounded = (x - lower >= 0.5) ? lower + 1.0 : lower;
    if (rounded == 0.0 && x < 0.0) {
        return -0.0;
    }
    return rounded;
}

/* JavaScript Math.min: NaN wins, and -0 is below 0. C's fmin does neither. */
static inline double nts_min(double a, double b) {
    if (isnan(a) || isnan(b)) {
        return (double)NAN;
    }
    if (a == 0.0 && b == 0.0) {
        return signbit(a) ? a : b;
    }
    return a < b ? a : b;
}

/* JavaScript Math.max. See nts_min. */
static inline double nts_max(double a, double b) {
    if (isnan(a) || isnan(b)) {
        return (double)NAN;
    }
    if (a == 0.0 && b == 0.0) {
        return signbit(a) ? b : a;
    }
    return a > b ? a : b;
}

#endif /* NTS_RUNTIME_H */
