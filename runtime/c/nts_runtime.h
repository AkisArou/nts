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
    /* RFC 8.1 says a descriptor describes the shape rather than the contents,
     * and a class's method table is part of its shape.
     *
     * Null for every class in a hierarchy where nothing is overridden, which is
     * most of them: a method no subclass replaces is a static call and needs no
     * table. Where there is one, a call is a load of this pointer and an
     * indirect call through it -- which is what dispatch costs when the compiler
     * has the whole hierarchy and can say which calls need it. */
    void *const *methods;
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

typedef NtsHeader NtsString;

/* An array is a header, a capacity, and a pointer to its elements.
 *
 * RFC 8.2 said an array and a string differ by descriptor rather than by shape,
 * with the elements inline after the header. That is right for a string and
 * wrong for an array, and the difference is `push`: an array grows, and growing
 * something whose elements are inline means moving it, which invalidates every
 * reference anyone holds. A string never grows, so it keeps the inline shape and
 * pays nothing for a field it would never use.
 *
 * `elements` points just past the struct until something grows the array, so a
 * fixed array still has its contents next to its header and reads them with the
 * same locality. What it costs is one load, and that load is loop-invariant --
 * clang hoists it out of any loop that does not call something which could
 * grow the array, which is most loops. */
typedef struct NtsArray {
    NtsHeader header;
    /* Elements the block can hold. `header.length` is how many it does hold. */
    uint32_t capacity;
    void *elements;
} NtsArray;

/* The inline elements of a string. */
#define NTS_ELEMENTS(a, T) ((T *)((unsigned char *)(a) + sizeof(NtsHeader)))
/* The elements of an array, wherever they are. */
#define NTS_ITEMS(a, T) ((T *)((a)->elements))

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
/* The same, without zeroing the elements. Only for an allocation the compiler
 * fills completely before anything can read it; see the definition. */
NtsArray *nts_array_new_uninitialized(const NtsDescriptor *descriptor,
                                      double length);
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
/* A function that reads memory and does nothing else.
 *
 * Not decoration. `text.indexOf("brown")` inside a loop is loop-invariant, and
 * a C compiler may only hoist it if it knows the call has no side effects --
 * which it cannot know from a declaration alone. Without this every search runs
 * once per iteration; the hand-written C++ reference gets the same hoist for
 * free because `std::string_view::find` is defined where the compiler can see
 * it.
 *
 * `pure` rather than `const`: these read through their pointers, so two calls
 * are only equal while the memory between them is unchanged, which is exactly
 * what `pure` promises. */
#if defined(__GNUC__) || defined(__clang__)
#define NTS_READS_ONLY __attribute__((pure))
#else
#define NTS_READS_ONLY
#endif

NTS_READS_ONLY double nts_str_code_point_at(const NtsString *s, double at);
NTS_READS_ONLY double nts_str_index_of(const NtsString *s, const NtsString *needle);
NTS_READS_ONLY double nts_str_last_index_of(const NtsString *s, const NtsString *needle);
NTS_READS_ONLY bool nts_str_includes(const NtsString *s, const NtsString *needle);
NTS_READS_ONLY bool nts_str_starts_with(const NtsString *s, const NtsString *needle);
NTS_READS_ONLY bool nts_str_ends_with(const NtsString *s, const NtsString *needle);
NtsString *nts_str_char_at(const NtsString *s, double at);
NtsString *nts_str_repeat(const NtsString *s, double times);
NtsString *nts_str_slice(const NtsString *s, double from, double to);
NtsString *nts_str_substring(const NtsString *s, double from, double to);

/* The same four, building into storage the caller supplies.
 *
 * A tokenizer's substrings are the shape this is for: made, read, and dropped
 * without ever being stored or returned. The compiler proves that -- the same
 * escape analysis that keeps an object in the frame -- and proves a bound on
 * the length, so the frame can hold one and the allocator is never called.
 *
 * `into` is `NTS_FRAME_STRING(n)`'s header, and the result is `NTS_IMMORTAL`,
 * so the release the counting pass emits for it is a no-op. Passing `NULL` is
 * the heap, which is what the four functions above do.
 *
 * The result *may be shorter* than the storage. That is the point of a bound:
 * `text.substring(start, i)` has no length until it runs, and what the compiler
 * knows is that it cannot exceed the string it came from. */
NtsString *nts_str_char_at_into(NtsHeader *into, const NtsString *s, double at);
NtsString *nts_str_slice_into(NtsHeader *into, const NtsString *s, double from,
                              double to);
NtsString *nts_str_substring_general(NtsHeader *into, const NtsString *s,
                                     double from, double to);
NtsString *nts_concat_into(NtsHeader *into, const NtsString *a,
                           const NtsString *b);

/* Frame storage for a string of at most `units` code units.
 *
 * `uint16_t` because a slice of a wide string is wide, and this has to hold the
 * widest the result can be. The extra unit is the terminating zero every
 * `NtsString` carries so that a one-byte string is directly usable as a C
 * string.
 *
 * One of these is declared per allocation *site* rather than per execution of
 * it, which is correct for exactly the reason the whole optimisation is: nothing
 * built here outlives the iteration that built it. */
#define NTS_FRAME_STRING(units)  \
    struct {                     \
        NtsHeader header;        \
        uint16_t data[(units) + 1]; \
    }

/* Build a string from UTF-8, which is how a C caller has one.
 *
 * The conversion is to UTF-16 code units, because that is what a JavaScript
 * string is and what every operation above counts. A byte sequence that is not
 * valid UTF-8 yields U+FFFD for each bad byte, which is what every decoder that
 * has to keep going does. */
NtsString *nts_string_from_utf8(const char *bytes, size_t length);
/* ECMAScript `Number::toString`, base 10. The shortest decimal that reads back
 * as the same double, laid out the way the specification lays it out -- which
 * is not what any `printf` conversion produces. */
NtsString *nts_number_to_string(double x);

/* The `Number` predicates. Exactly specified, unlike most of `Math` below.
 * `Number.isNaN` is absent because it is `x != x`, which the lowering emits
 * directly rather than paying for a call. */
bool nts_is_finite(double x);
bool nts_is_integer(double x);
bool nts_is_safe_integer(double x);

/* `Math`, forwarded. Two of these are not their libm namesakes: `pow` differs
 * from C's for a base of +/-1 and an infinite exponent, and `sign` has no libm
 * equivalent at all. See the definitions for what the specification says. */
double nts_math_pow(double base, double exponent);
double nts_math_sign(double x);
double nts_math_fround(double x);
double nts_math_log(double x);
double nts_math_log2(double x);
double nts_math_log10(double x);
double nts_math_log1p(double x);
double nts_math_exp(double x);
double nts_math_expm1(double x);
double nts_math_sin(double x);
double nts_math_cos(double x);
double nts_math_tan(double x);
double nts_math_asin(double x);
double nts_math_acos(double x);
double nts_math_atan(double x);
double nts_math_sinh(double x);
double nts_math_cosh(double x);
double nts_math_tanh(double x);
double nts_math_cbrt(double x);
double nts_math_atan2(double y, double x);
double nts_math_hypot(double a, double b);

/* Array methods, over arrays of numbers.
 *
 * What is here is what can be done *without growing* the array: the elements
 * live inline after the header, so growing would move the object and every
 * reference to it. `push`, `pop` and `splice` need a representation that keeps
 * the elements somewhere else, which is a decision with a cost -- an indirection
 * on every access -- and worth making deliberately rather than by accident.
 *
 * `map`, `filter` and `forEach` are absent for the other reason: they take a
 * function, and this compiler has no closures yet.
 *
 * `indexOf` and friends compare by value, which for numbers is what `===` does
 * -- except that `NaN === NaN` is false, so a `NaN` is never found. `includes`
 * uses SameValueZero and *does* find one, which is the one place the two differ
 * and the one thing an implementation is likely to get wrong. */
/* Growth. `push` returns the new length, which is what the expression is worth
 * in JavaScript, and reallocates the element block when the capacity runs out --
 * doubling, so a loop of pushes is linear rather than quadratic.
 *
 * The array object itself never moves, which is the whole reason the elements
 * are not inline: every reference anyone holds stays valid. */
double nts_array_push(NtsArray *a, double value);
double nts_array_pop(NtsArray *a);
NTS_READS_ONLY double nts_array_index_of(const NtsArray *a, double needle);
NTS_READS_ONLY double nts_array_last_index_of(const NtsArray *a, double needle);
NTS_READS_ONLY bool nts_array_includes(const NtsArray *a, double needle);
NTS_READS_ONLY double nts_array_at(const NtsArray *a, double at);
/* Report an uncaught throw and stop.
 *
 * There is no `try`/`catch` yet, so every throw is uncaught by construction and
 * a throw is a *termination* -- which is what it is for a program with no
 * handler, and what these programs mean by it. When handlers arrive this
 * becomes the last resort rather than the only one. */
void nts_thrown(const NtsString *message);
NtsArray *nts_array_fill(NtsArray *a, double value);
/* The same for an array of booleans, which is a byte per element rather than
 * eight. A separate entry point rather than a generic one taking a width: the
 * compiler knows the element type, and a runtime that had to be told it would
 * be told it wrongly one day. */
NtsArray *nts_array_fill_bool(NtsArray *a, bool value);
/* And for an array of references, which additionally has to count them: one
 * retain per slot, and one release for whatever the slot held. The caller's own
 * reference is untouched, so this is a store rather than a hand-over. */
NtsArray *nts_array_fill_ref(NtsArray *a, void *value);
NtsArray *nts_array_reverse(NtsArray *a);
NtsArray *nts_array_slice(const NtsArray *a, double from, double to);

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
    /* The case every index in every real program actually is: a value whose
     * truncation fits in an `int64`. That is one instruction, and the round
     * trip back to a double is exact -- a number in this range that was
     * already whole is unchanged, and one that was not is truncated toward
     * zero, which is what ToIntegerOrInfinity says.
     *
     * `floor` is a call into libm, and a call inside a scan loop costs more
     * than the loop does. It clobbers every caller-saved register, so the
     * constants the surrounding code was holding across the loop are spilled
     * and reloaded around it -- five reloads per call in the string
     * benchmark, for a truncation.
     *
     * NaN fails both comparisons and falls through to the check below; the
     * infinities fail them too and reach `floor`, which returns them
     * unchanged, as ToIntegerOrInfinity requires. */
    if (value > -9223372036854775808.0 && value < 9223372036854775808.0) {
        return (double)(int64_t)value;
    }
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
    if (index >= array->header.length) {
        nts_bounds((double)index, array->header.length);
    }
    return index;
}

/* A double index must also be a whole number to name an element at all --
 * `xs[1.5]` is a property in JavaScript, not a slot. NaN fails the first
 * comparison. */
static inline uint32_t nts_index(const NtsArray *array, double index) {
    if (!(index >= 0.0 && index < (double)array->header.length
          && index == (double)(uint32_t)index)) {
        nts_bounds(index, array->header.length);
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

/* What a typed array stores. `u8[i] = v` is not a cast: ECMAScript truncates
 * toward zero and takes the result modulo the width, sending every non-finite
 * value to zero, so `u8[i] = 300` stores 44, `u8[i] = 1.7` stores 1, and
 * `u8[i] = NaN` stores 0. C's `(uint8_t)someDouble` is *undefined behaviour*
 * for all three, which is why the compiler emits a named conversion rather
 * than letting the backend cast.
 *
 * Each is ToUint32 and then a truncation, which is the same value: 2^32 is a
 * multiple of 2^8 and of 2^16, so reducing modulo the larger first changes
 * nothing. That reuses the fast path above -- one comparison and a hardware
 * conversion for a value already in range -- instead of a second `fmod`.
 *
 * The signed forms subtract rather than casting a too-large unsigned value,
 * whose result is implementation-defined before C23. The subtraction lands in
 * range, so the cast that follows it is not. */
static inline uint8_t nts_to_uint8(double x) {
    return (uint8_t)nts_to_uint32(x);
}

static inline int8_t nts_to_int8(double x) {
    const uint8_t u = (uint8_t)nts_to_uint32(x);
    return u < 128u ? (int8_t)u : (int8_t)((int)u - 256);
}

static inline uint16_t nts_to_uint16(double x) {
    return (uint16_t)nts_to_uint32(x);
}

static inline int16_t nts_to_int16(double x) {
    const uint16_t u = (uint16_t)nts_to_uint32(x);
    return u < 32768u ? (int16_t)u : (int16_t)((int)u - 65536);
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

/* `substring` into the frame, with the case a tokenizer is spelled out here.
 *
 * Two indices the caller already computed as positions in this string, in
 * order, and a narrow source: then clamping is a comparison, the width question
 * is already answered, and the whole operation is a header and a `memcpy`.
 * Anything else -- a negative index, a fraction, a reversed pair, a wide source
 * -- goes to the general form.
 *
 * Worth spelling out because the out-of-line call re-derives what the caller
 * knew: the compiler held two `int32`s and widened them to doubles to pass
 * them, and the callee's first act was to work out that they were whole and in
 * range. The same trade as `nts_unit`, made for the same reason -- the work is
 * a copy, and the call around it was most of the cost.
 *
 * The order of the tests is load-bearing. `from` and `to` are proved to be in
 * `[0, length]` *before* either is converted, because converting a double
 * outside `uint32` is undefined rather than merely wrong. A NaN fails every
 * comparison and leaves by the same door. */
static inline NtsString *nts_str_substring_into(NtsHeader *into,
                                                const NtsString *s, double from,
                                                double to) {
    if (into != 0 && from >= 0.0 && to >= from && to <= (double)s->length
        && (s->flags & NTS_TWO_BYTE) == 0) {
        const uint32_t start = (uint32_t)from;
        const uint32_t end = (uint32_t)to;
        if (from == (double)start && to == (double)end) {
            const uint32_t length = end - start;
            into->descriptor = &nts_desc_string1;
            into->reserved = NTS_IMMORTAL;
            into->flags = 0;
            into->length = length;
            unsigned char *bytes = NTS_ELEMENTS(into, unsigned char);
            memcpy(bytes, NTS_ELEMENTS(s, const unsigned char) + start, length);
            bytes[length] = 0;
            return into;
        }
    }
    return nts_str_substring_general(into, s, from, to);
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

/* Two kinds of abort, and the difference is not cosmetic.
 *
 * A *refusal* is the program correctly declining something the language does
 * not permit for the input it was given: an index outside an array, a string
 * longer than a string can be, an array length that is not one. JavaScript
 * throws there, and a compiled program that has no exceptions yet stops
 * instead. Neither side produces a value, so a differential has nothing to
 * compare and the case is skipped.
 *
 * Everything else is a *defect*: an invariant this runtime maintains that has
 * been broken. Reading a number from a promise holding a reference, an
 * unbalanced checkpoint, a task posted before a host exists.
 *
 * The prefix is how a harness tells them apart. It used to match on the text of
 * one message, which meant two other perfectly good refusals read as defects
 * the first time anything checked. Saying which kind it is belongs here, where
 * the answer is known. */
#define NTS_REFUSED "nts: refused: "

/* --- Tasks, the host seam, and the checkpoint (RFC 12.1, 26; docs/async.md) -
 *
 * The runtime owns language behavior; the host owns execution environment
 * behavior. Promise ordering is specified and observable, so it stays here. The
 * loop is the host's, and the host reaches it through the vtable below and
 * nothing else.
 */

/* A unit of deferred work.
 *
 * `run` is a *compiler-emitted trampoline*, not a runtime closure wrapper: it
 * knows the exact signature of the thing it calls, because the call site did.
 * That is also what keeps the drain the caller of a tick callback rather than
 * something between them, which a stack trace can see.
 *
 * `state` is usually a managed object, and a queued task owns a reference to
 * it. Whoever holds the task must eventually either run it or drop it -- both
 * give the reference back. A host that discards a task on teardown without
 * saying so leaks the frame and everything it holds. */
typedef struct NtsTask {
    void (*run)(void *state);
    /* Release `state` without running. Null when there is nothing owned. */
    void (*drop)(void *state);
    void *state;
} NtsTask;

typedef uint64_t NtsTimerId;

/* Everything a host provides. Five operations and one opt-out. */
typedef struct NtsHost {
    /* Run after the current task *and* after a complete checkpoint. That
     * ordering is what `setImmediate` is built on, so it is specified here
     * rather than left for each host to reproduce. */
    void (*post_task)(void *state, NtsTask task);

    /* Run after at least `delay_ms`. The id is what `clearTimeout` cancels. */
    NtsTimerId (*post_delayed)(void *state, NtsTask task, double delay_ms,
                               bool repeating);
    void (*cancel_delayed)(void *state, NtsTimerId id);

    /* The only operation callable from a thread the runtime does not own.
     * Every foreign completion goes through it before touching the heap:
     * resolving a promise is a heap mutation (RFC 17.4). */
    void (*post_from_any_thread)(void *state, NtsTask task);

    /* For assertions, and cheap enough to leave on. */
    bool (*is_owner_thread)(void *state);

    /* Optional, and null for every host but a Blink renderer. Supplying it
     * means the host owns checkpointing: our queues and our drain are both
     * disabled, so there is one queue and one ordering (RFC 26.6). */
    void (*enqueue_microtask)(void *state, NtsTask task);

    void *state;
} NtsHost;

void nts_host_install(const NtsHost *host);

/* Run a task with the checkpoint around it. Hosts call *this*, never
 * `task.run`, so a host cannot omit a checkpoint by forgetting. */
void nts_task_run(NtsTask task);

/* Post to the host. Thin, but they are where the ownership contract is
 * documented, and where the owner-thread assertion lives. */
void nts_post_task(NtsTask task);
NtsTimerId nts_post_delayed(NtsTask task, double delay_ms, bool repeating);
void nts_cancel_delayed(NtsTimerId id);
void nts_post_from_any_thread(NtsTask task);
bool nts_is_owner_thread(void);

/* The two queues. */
void nts_enqueue_microtask(NtsTask task);
void nts_enqueue_tick(NtsTask task);

/* Nesting, by depth: a capability may re-enter compiled code synchronously and
 * only the outermost return is a checkpoint. */
void nts_enter(void);
void nts_leave(void);

/* Whether either queue has anything left. For an embedder driving its own
 * loop, and for a test asserting quiescence. */
bool nts_has_pending_work(void);

/* --- Promises (RFC 12; docs/async.md 5a) -----------------------------------
 *
 * The runtime never learns what a promise's value *is*, for the same reason it
 * never learns a closure's signature: whoever reads it was compiled knowing.
 * It still has to store it, so the payload is a closed two-slot union with a
 * tag -- the same closed set of machine representations as the typed-array
 * element table, written down rather than discovered.
 */

enum {
    NTS_PROMISE_PENDING = 0,
    NTS_PROMISE_FULFILLED = 1,
    NTS_PROMISE_REJECTED = 2
};

enum {
    NTS_PAYLOAD_NONE = 0,
    NTS_PAYLOAD_NUMBER = 1,
    NTS_PAYLOAD_REFERENCE = 2
};

/* One reaction, as a managed object.
 *
 * A managed object rather than a bare `NtsTask` in a list because the
 * collector walks two shapes -- an array of references, and an object with
 * reference fields at fixed offsets -- and a dynamic list of triples is
 * neither. This is the second shape, and the list is the first, so nothing in
 * the collector needs a special case. */
typedef struct NtsReaction {
    NtsHeader header;
    void (*run)(void *state);
    void (*drop)(void *state);
    NtsHeader *state;
    /* The list is threaded through the reactions themselves rather than held
     * in an array: an array of references would need its own growth and its
     * elements are written through a `double`-typed helper. A chain of
     * fixed-offset objects needs neither, and one allocation per reaction is
     * what an array would have cost anyway. */
    struct NtsReaction *next;
} NtsReaction;

typedef struct NtsPromise {
    NtsHeader header;
    uint32_t state;   /* NTS_PROMISE_* */
    uint32_t payload; /* NTS_PAYLOAD_* */
    double number;
    /* The fulfilled value when it is a reference, or the rejection reason,
     * which always is one. */
    NtsHeader *reference;
    /* Newest first; reversed into subscription order when it settles, so the
     * chain holds exactly one strong reference to each reaction and there is
     * no aliasing tail pointer for the collector to double-count. */
    NtsReaction *reactions;
} NtsPromise;

NtsPromise *nts_promise_new(void);

/* Settle it. A promise settles once: a second call is ignored rather than
 * refused, because that is what the specification says and programs rely on
 * it. Each asserts the owner thread. */
void nts_promise_fulfill_void(NtsPromise *promise);
void nts_promise_fulfill_number(NtsPromise *promise, double value);
void nts_promise_fulfill_reference(NtsPromise *promise, NtsHeader *value);
void nts_promise_reject(NtsPromise *promise, NtsHeader *reason);

/* Run `reaction` when it settles, or on the microtask queue if it already has.
 * Already-settled does *not* run inline: that would change the tick count,
 * which is observable through interleaving. */
void nts_promise_subscribe(NtsPromise *promise, NtsTask reaction);

/* What a settled promise holds, for the resumed frame that has to read it.
 *
 * The compiler knows which one to call, because the payload's representation is
 * in the type. A number read out of a promise that settled with a reference
 * would be a pointer reinterpreted as a double, so these assert rather than
 * guess. */
double nts_promise_number(const NtsPromise *promise);
NtsHeader *nts_promise_reference(const NtsPromise *promise);

/* Whether the resumed state machine has to propagate a rejection rather than
 * read a value. A rejected promise has no payload and both readers above
 * assert, so an `await` asks this first. */
bool nts_promise_is_rejected(const NtsPromise *promise);
/* Reject `result` with whatever `source` was rejected with. One call, so the
 * reason never has to become a typed value on the compiler's side. */
void nts_promise_reject_with(NtsPromise *result, const NtsPromise *source);

/* --- Combinators (docs/async.md 5b) ----------------------------------------
 *
 * `Promise.all` fulfils with the values in *input* order once every element
 * has fulfilled, and rejects with the first rejection. `Promise.race` settles
 * with the first settlement of either kind. Both subscribe to every element
 * before returning, so an element that settles during the call is not missed.
 *
 * `values` is the result array, allocated by the compiler because only it
 * knows whether a payload is a double or a pointer -- and an array carries its
 * own descriptor, so the runtime reads that fact back rather than being told
 * it twice. It must have the length of `promises`. `race` keeps no values, so
 * it takes none. */
NtsPromise *nts_promise_all(NtsArray *promises, NtsArray *values);
NtsPromise *nts_promise_race(NtsArray *promises);

/* --- Timers (docs/async.md 8) ----------------------------------------------
 *
 * A capability over the host's `post_delayed`, so both hosts have it and
 * neither implements it. `callback` is a closure and `slot` is its method
 * index, because a closure is an object with a method table and calling one
 * needs both.
 *
 * The id is a `double` because that is what `setTimeout` returns to a program.
 * A host's `NtsTimerId` is wider, so a host must not hand out an id that
 * cannot survive the round trip -- 2^53, not 2^64. */
double nts_set_timeout(NtsHeader *callback, double slot, double delay_ms,
                       bool repeating);
void nts_clear_timeout(double id);
/* `setImmediate` is `nts_post_task` with the same callback object, and is not
 * here because nothing can reach it: it is a Node global, absent from the
 * default library, so no program this compiler accepts today can call it. It
 * belongs with the profile that declares it. */

#endif /* NTS_RUNTIME_H */
