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
#include <string.h>

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

/* String methods.
 *
 * Every one of these is defined over UTF-16 code units, which is what a
 * `NtsString` holds and what JavaScript means by a string's contents, so each is
 * the operation the specification describes rather than an approximation of it.
 *
 * `toUpperCase`, `toLowerCase` and `trim` are deliberately absent. All three are
 * defined over Unicode rather than over ASCII, and an ASCII version would be
 * right for most inputs and quietly wrong for the rest.
 *
 * Indices arrive as doubles because that is what a JavaScript number is, and
 * each function does its own clamping -- `ToIntegerOrInfinity` then a clamp to
 * the length, which is what the specification says and what makes `s.slice(-2)`
 * mean the last two. A caller that passes `INFINITY` means "to the end", which
 * is how an omitted trailing argument reaches here. */
double nts_str_code_point_at(const NtsString *s, double at);
double nts_str_index_of(const NtsString *s, const NtsString *needle);
double nts_str_last_index_of(const NtsString *s, const NtsString *needle);
bool nts_str_includes(const NtsString *s, const NtsString *needle);
bool nts_str_starts_with(const NtsString *s, const NtsString *needle);
bool nts_str_ends_with(const NtsString *s, const NtsString *needle);
NtsString *nts_str_char_at(const NtsString *s, double at);
NtsString *nts_str_repeat(const NtsString *s, double times);
NtsString *nts_str_slice(const NtsString *s, double from, double to);
NtsString *nts_str_substring(const NtsString *s, double from, double to);

/* Build a string from UTF-8, which is how a C caller has one.
 *
 * The conversion is to UTF-16 code units, because that is what a JavaScript
 * string is and what every operation above counts. A byte sequence that is not
 * valid UTF-8 yields U+FFFD for each bad byte, which is what every decoder that
 * has to keep going does. */
NtsString *nts_string_from_utf8(const char *bytes, size_t length);

/* One code unit of a string, whichever width it is stored in.
 *
 * Inline, and so is `charCodeAt` below it. A scan by code unit is the inner loop
 * of every string-heavy program, and as an opaque call it was fifty times slower
 * than the same loop in C++ -- the work is a load and a compare, and the call
 * around it was the whole cost. */
static inline uint16_t nts_unit(const NtsString *s, uint32_t at) {
    if ((s->flags & NTS_TWO_BYTE) != 0) {
        return NTS_ELEMENTS(s, uint16_t)[at];
    }
    return NTS_ELEMENTS(s, unsigned char)[at];
}

/* `ToIntegerOrInfinity`: truncate toward zero, and NaN becomes zero.
 *
 * An index is not required to be a whole number. `s.charCodeAt(0.5)` is the
 * character at 0, not an error and not NaN -- rejecting the fraction was the
 * first thing differential testing found here. */
static inline double nts_to_integer(double value) {
    if (value != value) {
        return 0.0;
    }
    return value < 0 ? -floor(-value) : floor(value);
}

static inline double nts_str_char_code_at(const NtsString *s, double at) {
    at = nts_to_integer(at);
    if (at < 0 || at >= (double)s->length) {
        /* Out of range is NaN, not an error and not zero. */
        return (double)NAN;
    }
    return (double)nts_unit(s, (uint32_t)at);
}

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
    /* The common case: already in range, so the hardware conversion is the
     * answer and it truncates toward zero exactly as ToInt32 says. */
    if (x > -2147483649.0 && x < 2147483648.0) {
        return (int32_t)x;
    }

    /* Out of range, which `x | 0` after any real arithmetic usually is: a
     * product of two int32s is not one. This used to reduce modulo 2^32 with
     * `fmod`, which is a library call of roughly a hundred cycles -- and in a
     * loop that is the whole cost of the loop. Reading the exponent and shifting
     * the mantissa does the same reduction in about ten instructions, none of
     * them a call.
     *
     * NaN and the infinities fall out of the same test: their exponent is 1024,
     * which is past the point where every one of the low thirty-two bits is
     * zero, so they return 0 -- which is what ToInt32 says they are. */
    uint64_t bits;
    memcpy(&bits, &x, sizeof bits);
    const int exponent = (int)((bits >> 52) & 0x7FFu) - 1023;
    if (exponent < 0) {
        /* |x| < 1, so truncation is zero -- including for -0. */
        return 0;
    }
    if (exponent > 83) {
        /* A multiple of 2^32 (or NaN, or an infinity): nothing in the low
         * thirty-two bits. */
        return 0;
    }
    const uint64_t mantissa = (bits & 0xFFFFFFFFFFFFFull) | 0x10000000000000ull;
    uint32_t magnitude;
    if (exponent < 52) {
        magnitude = (uint32_t)(mantissa >> (52 - exponent));
    } else {
        /* Only the low thirty-two bits survive, so the shift is done in
         * thirty-two and cannot overflow out of the range that matters. */
        magnitude = (uint32_t)mantissa << (exponent - 52);
    }
    /* Negation in unsigned arithmetic: `-(int32_t)0x80000000` is undefined, and
     * that value is reachable. */
    return (bits >> 63) != 0 ? (int32_t)(0u - magnitude) : (int32_t)magnitude;
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
