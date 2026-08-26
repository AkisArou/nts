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
 * type, not one per object. `traced` is the reference-field map in its simplest
 * form: an array of scalars and a string have no references to trace. */
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
    uint32_t traced;
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

/* An object the program did not allocate -- a string literal in static data --
 * carries this count and is never freed. A sentinel rather than a flag bit so
 * that retain and release need no branch beyond the one they already have. */
#define NTS_IMMORTAL UINT32_MAX

void *nts_alloc(size_t bytes);
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

/* JavaScript Math.round: a half goes toward positive infinity, not away from
 * zero. C's round(-1.5) is -2; this is -1. */
static inline double nts_round(double x) {
    if (!isfinite(x)) {
        return x;
    }
    return floor(x + 0.5);
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
