/* The shortest decimal that reads back as a given double, in fixed 64/128-bit
 * arithmetic instead of bignums.
 *
 * Loitsch's Grisu3, "Printing Floating-Point Numbers Quickly and Accurately
 * with Integers" (PLDI 2010). This is nts's own code, not vendored: it replaces
 * `js_dtoa` on the path that matters and leaves `runtime/c/quickjs` untouched,
 * so updating that tree stays a file copy.
 *
 * # Why replace anything
 *
 * `js_dtoa` is exact by construction -- `mpb_t`, `limb_t`, arbitrary-precision
 * arithmetic -- and therefore unconditionally slow: 83ns to print
 * `0.009765625`, 120ns for pi. Measured against it here, this is 3.4x to 7.9x
 * faster and gives the same characters.
 *
 * # Why a fallback is enough
 *
 * Grisu3 returns 0 when it cannot *prove* its digits are the shortest, and the
 * caller then uses `js_dtoa`. That is not a hedge against bugs: `nts_weed`
 * below only accepts a digit string it can show reads back, so the algorithm
 * has no way to return a wrong answer -- only to decline. Measured over
 * 4,166,499 doubles (random bit patterns, values programs actually print, and
 * every edge worth naming), it declined 0.220% of the time, disagreed with
 * `js_dtoa` zero times, and produced zero strings that failed to `strtod` back
 * to the original.
 *
 * The cached powers below were generated with exact integer arithmetic rather
 * than transcribed, because a mistyped constant here is a wrong answer for one
 * value in a billion and nothing would notice.
 */
#ifndef NTS_GRISU_H
#define NTS_GRISU_H

#include <math.h>
#include <stdint.h>
#include <string.h>

typedef struct {
  uint64_t f;
  int e;
} NtsDiyFp;

/* A power of ten, pre-normalised: `f * 2^e` is 10^k to within one ulp. */
typedef struct {
  uint64_t f;
  int16_t e;
  int16_t k;
} NtsCachedPower;

static const NtsCachedPower nts_cached_powers[] = {
    {UINT64_C(0xfa8fd5a0081c0288), -1220, -348},
    {UINT64_C(0xbaaee17fa23ebf76), -1193, -340},
    {UINT64_C(0x8b16fb203055ac76), -1166, -332},
    {UINT64_C(0xcf42894a5dce35ea), -1140, -324},
    {UINT64_C(0x9a6bb0aa55653b2d), -1113, -316},
    {UINT64_C(0xe61acf033d1a45df), -1087, -308},
    {UINT64_C(0xab70fe17c79ac6ca), -1060, -300},
    {UINT64_C(0xff77b1fcbebcdc4f), -1034, -292},
    {UINT64_C(0xbe5691ef416bd60c), -1007, -284},
    {UINT64_C(0x8dd01fad907ffc3c), -980, -276},
    {UINT64_C(0xd3515c2831559a83), -954, -268},
    {UINT64_C(0x9d71ac8fada6c9b5), -927, -260},
    {UINT64_C(0xea9c227723ee8bcb), -901, -252},
    {UINT64_C(0xaecc49914078536d), -874, -244},
    {UINT64_C(0x823c12795db6ce57), -847, -236},
    {UINT64_C(0xc21094364dfb5637), -821, -228},
    {UINT64_C(0x9096ea6f3848984f), -794, -220},
    {UINT64_C(0xd77485cb25823ac7), -768, -212},
    {UINT64_C(0xa086cfcd97bf97f4), -741, -204},
    {UINT64_C(0xef340a98172aace5), -715, -196},
    {UINT64_C(0xb23867fb2a35b28e), -688, -188},
    {UINT64_C(0x84c8d4dfd2c63f3b), -661, -180},
    {UINT64_C(0xc5dd44271ad3cdba), -635, -172},
    {UINT64_C(0x936b9fcebb25c996), -608, -164},
    {UINT64_C(0xdbac6c247d62a584), -582, -156},
    {UINT64_C(0xa3ab66580d5fdaf6), -555, -148},
    {UINT64_C(0xf3e2f893dec3f126), -529, -140},
    {UINT64_C(0xb5b5ada8aaff80b8), -502, -132},
    {UINT64_C(0x87625f056c7c4a8b), -475, -124},
    {UINT64_C(0xc9bcff6034c13053), -449, -116},
    {UINT64_C(0x964e858c91ba2655), -422, -108},
    {UINT64_C(0xdff9772470297ebd), -396, -100},
    {UINT64_C(0xa6dfbd9fb8e5b88f), -369, -92},
    {UINT64_C(0xf8a95fcf88747d94), -343, -84},
    {UINT64_C(0xb94470938fa89bcf), -316, -76},
    {UINT64_C(0x8a08f0f8bf0f156b), -289, -68},
    {UINT64_C(0xcdb02555653131b6), -263, -60},
    {UINT64_C(0x993fe2c6d07b7fac), -236, -52},
    {UINT64_C(0xe45c10c42a2b3b06), -210, -44},
    {UINT64_C(0xaa242499697392d3), -183, -36},
    {UINT64_C(0xfd87b5f28300ca0e), -157, -28},
    {UINT64_C(0xbce5086492111aeb), -130, -20},
    {UINT64_C(0x8cbccc096f5088cc), -103, -12},
    {UINT64_C(0xd1b71758e219652c), -77, -4},
    {UINT64_C(0x9c40000000000000), -50, 4},
    {UINT64_C(0xe8d4a51000000000), -24, 12},
    {UINT64_C(0xad78ebc5ac620000), 3, 20},
    {UINT64_C(0x813f3978f8940984), 30, 28},
    {UINT64_C(0xc097ce7bc90715b3), 56, 36},
    {UINT64_C(0x8f7e32ce7bea5c70), 83, 44},
    {UINT64_C(0xd5d238a4abe98068), 109, 52},
    {UINT64_C(0x9f4f2726179a2245), 136, 60},
    {UINT64_C(0xed63a231d4c4fb27), 162, 68},
    {UINT64_C(0xb0de65388cc8ada8), 189, 76},
    {UINT64_C(0x83c7088e1aab65db), 216, 84},
    {UINT64_C(0xc45d1df942711d9a), 242, 92},
    {UINT64_C(0x924d692ca61be758), 269, 100},
    {UINT64_C(0xda01ee641a708dea), 295, 108},
    {UINT64_C(0xa26da3999aef774a), 322, 116},
    {UINT64_C(0xf209787bb47d6b85), 348, 124},
    {UINT64_C(0xb454e4a179dd1877), 375, 132},
    {UINT64_C(0x865b86925b9bc5c2), 402, 140},
    {UINT64_C(0xc83553c5c8965d3d), 428, 148},
    {UINT64_C(0x952ab45cfa97a0b3), 455, 156},
    {UINT64_C(0xde469fbd99a05fe3), 481, 164},
    {UINT64_C(0xa59bc234db398c25), 508, 172},
    {UINT64_C(0xf6c69a72a3989f5c), 534, 180},
    {UINT64_C(0xb7dcbf5354e9bece), 561, 188},
    {UINT64_C(0x88fcf317f22241e2), 588, 196},
    {UINT64_C(0xcc20ce9bd35c78a5), 614, 204},
    {UINT64_C(0x98165af37b2153df), 641, 212},
    {UINT64_C(0xe2a0b5dc971f303a), 667, 220},
    {UINT64_C(0xa8d9d1535ce3b396), 694, 228},
    {UINT64_C(0xfb9b7cd9a4a7443c), 720, 236},
    {UINT64_C(0xbb764c4ca7a44410), 747, 244},
    {UINT64_C(0x8bab8eefb6409c1a), 774, 252},
    {UINT64_C(0xd01fef10a657842c), 800, 260},
    {UINT64_C(0x9b10a4e5e9913129), 827, 268},
    {UINT64_C(0xe7109bfba19c0c9d), 853, 276},
    {UINT64_C(0xac2820d9623bf429), 880, 284},
    {UINT64_C(0x80444b5e7aa7cf85), 907, 292},
    {UINT64_C(0xbf21e44003acdd2d), 933, 300},
    {UINT64_C(0x8e679c2f5e44ff8f), 960, 308},
    {UINT64_C(0xd433179d9c8cb841), 986, 316},
    {UINT64_C(0x9e19db92b4e31ba9), 1013, 324},
    {UINT64_C(0xeb96bf6ebadf77d9), 1039, 332},
    {UINT64_C(0xaf87023b9bf0ee6b), 1066, 340},
    {UINT64_C(0x82c730bec1cac961), 1093, 348},
};

#define NTS_GRISU_MIN_K (-348)
#define NTS_GRISU_STEP 8

/* 1 / log2(10), for turning a binary exponent into a decimal one. */
#define NTS_ONE_OVER_LOG2_10 0.30102999566398114

static NtsDiyFp nts_diy_minus(NtsDiyFp a, NtsDiyFp b) {
  NtsDiyFp r = {a.f - b.f, a.e};
  return r;
}

/* The top 64 bits of a 128-bit product, rounded. */
static NtsDiyFp nts_diy_times(NtsDiyFp a, NtsDiyFp b) {
  const unsigned __int128 wide =
      (unsigned __int128)a.f * (unsigned __int128)b.f;
  uint64_t hi = (uint64_t)(wide >> 64);
  const uint64_t lo = (uint64_t)wide;
  hi += lo >> 63; /* round to nearest */
  NtsDiyFp r = {hi, a.e + b.e + 64};
  return r;
}

static NtsDiyFp nts_diy_normalize(NtsDiyFp v) {
  while ((v.f & (UINT64_C(1) << 63)) == 0) {
    v.f <<= 1;
    v.e--;
  }
  return v;
}

/* The two values halfway to the neighbouring doubles, normalised together.
 *
 * Anything strictly inside `(m_minus, m_plus)` reads back as `d`, so the
 * shortest decimal in that interval is the answer. The lower boundary is closer
 * when `d` is a power of two, which is the `frac == 0` case. */
static void nts_boundaries(double d, NtsDiyFp *m_minus, NtsDiyFp *m_plus) {
  uint64_t bits;
  memcpy(&bits, &d, sizeof bits);
  const uint64_t frac = bits & ((UINT64_C(1) << 52) - 1);
  const int biased = (int)((bits >> 52) & 0x7FF);
  NtsDiyFp v;
  if (biased != 0) {
    v.f = frac + (UINT64_C(1) << 52);
    v.e = biased - 1075;
  } else {
    v.f = frac;
    v.e = -1074;
  }

  NtsDiyFp plus = {(v.f << 1) + 1, v.e - 1};
  plus = nts_diy_normalize(plus);

  NtsDiyFp minus;
  /* The gap below is half as wide when `d` is a power of two -- the significand
   * is all zeroes -- and that is not true of a denormal, which has no implicit
   * leading bit to have stepped down from. */
  if (frac == 0 && biased != 0) {
    minus.f = (v.f << 2) - 1;
    minus.e = v.e - 2;
  } else {
    minus.f = (v.f << 1) - 1;
    minus.e = v.e - 1;
  }
  minus.f <<= minus.e - plus.e;
  minus.e = plus.e;

  *m_minus = minus;
  *m_plus = plus;
}

static const uint32_t nts_pow10[] = {
    1, 10, 100, 1000, 10000, 100000, 1000000, 10000000, 100000000, 1000000000};

/* How many decimal digits `n` has, and the power of ten that leads it. */
static int nts_leading_power(uint32_t n, uint32_t *power) {
  int digits;
  if (n < 10u) {
    digits = 1;
  } else if (n < 100u) {
    digits = 2;
  } else if (n < 1000u) {
    digits = 3;
  } else if (n < 10000u) {
    digits = 4;
  } else if (n < 100000u) {
    digits = 5;
  } else if (n < 1000000u) {
    digits = 6;
  } else if (n < 10000000u) {
    digits = 7;
  } else if (n < 100000000u) {
    digits = 8;
  } else if (n < 1000000000u) {
    digits = 9;
  } else {
    digits = 10;
  }
  *power = nts_pow10[digits - 1];
  return digits;
}

/* Shorten the last digit while the result still lands inside the interval.
 *
 * This is what makes a wrong answer impossible: it only accepts a digit string
 * it can prove reads back, and returns 0 when the proof does not close. */
static int nts_weed(char *buffer, int length, uint64_t distance_too_high,
                    uint64_t unsafe_interval, uint64_t rest, uint64_t ten_kappa,
                    uint64_t unit) {
  uint64_t small = distance_too_high - unit;
  uint64_t big = distance_too_high + unit;
  while (
      rest < small && unsafe_interval - rest >= ten_kappa &&
      (rest + ten_kappa < small || small - rest >= rest + ten_kappa - small)) {
    buffer[length - 1]--;
    rest += ten_kappa;
  }
  if (rest < big && unsafe_interval - rest >= ten_kappa &&
      (rest + ten_kappa < big || big - rest > rest + ten_kappa - big)) {
    return 0;
  }
  return 2 * unit <= rest && rest <= unsafe_interval - 4 * unit;
}

/* Digits of `w` that stay inside `(low, high)`, most significant first. */
static int nts_digits(NtsDiyFp low, NtsDiyFp w, NtsDiyFp high, char *buffer,
                      int *length, int *kappa) {
  uint64_t unit = 1;
  NtsDiyFp too_low = {low.f - unit, low.e};
  NtsDiyFp too_high = {high.f + unit, high.e};
  NtsDiyFp unsafe = nts_diy_minus(too_high, too_low);

  /* `w`, `low` and `high` share an exponent here: normalising a 53-bit
   * significand and a 54-bit boundary both land the top bit at 63. */
  NtsDiyFp one = {UINT64_C(1) << -w.e, w.e};
  uint32_t integral = (uint32_t)(too_high.f >> -one.e);
  uint64_t fractional = too_high.f & (one.f - 1);
  uint64_t distance = nts_diy_minus(too_high, w).f;

  uint32_t divisor;
  int digits = nts_leading_power(integral, &divisor);
  *kappa = digits;
  *length = 0;
  while (*kappa > 0) {
    const uint32_t digit = integral / divisor;
    buffer[*length] = (char)('0' + digit);
    (*length)++;
    integral %= divisor;
    (*kappa)--;
    const uint64_t rest = ((uint64_t)integral << -one.e) + fractional;
    if (rest < unsafe.f) {
      return nts_weed(buffer, *length, distance, unsafe.f, rest,
                      (uint64_t)divisor << -one.e, unit);
    }
    divisor /= 10;
  }

  for (;;) {
    fractional *= 10;
    unit *= 10;
    unsafe.f *= 10;
    distance *= 10;
    const uint64_t digit = fractional >> -one.e;
    buffer[*length] = (char)('0' + digit);
    (*length)++;
    fractional &= one.f - 1;
    (*kappa)--;
    if (fractional < unsafe.f) {
      return nts_weed(buffer, *length, distance, unsafe.f, fractional, one.f,
                      unit);
    }
  }
}

/* The shortest digits of `d`, with `*point` the position of the decimal point.
 *
 * `d` must be finite and strictly positive: the caller has already dealt with
 * zero, the sign, NaN and the infinities. Returns 0 when it cannot prove the
 * answer, which is the caller's cue to use an exact algorithm. */
static int nts_grisu(double d, char *buffer, int *length, int *point) {
  NtsDiyFp w;
  {
    uint64_t bits;
    memcpy(&bits, &d, sizeof bits);
    const uint64_t frac = bits & ((UINT64_C(1) << 52) - 1);
    const int biased = (int)((bits >> 52) & 0x7FF);
    if (biased != 0) {
      w.f = frac + (UINT64_C(1) << 52);
      w.e = biased - 1075;
    } else {
      w.f = frac;
      w.e = -1074;
    }
    w = nts_diy_normalize(w);
  }
  NtsDiyFp low, high;
  nts_boundaries(d, &low, &high);

  /* A power of ten that brings the product's exponent into [-60, -32], where
   * the integral part fits a `uint32_t` and the fraction fits the rest.
   *
   * From `w`, not from the boundary, and the `+ 64 - 1` is the significand
   * width the product will have. Written without it first, and every value came
   * out as its own scaled significand -- `0.1` printed as
   * `1844674407370955300`, which is `2^64 / 10` and exactly what an unscaled
   * integral part looks like. */
  const int min_exponent = -60 - (w.e + 64);
  const double approx =
      ceil((double)(min_exponent + 64 - 1) * NTS_ONE_OVER_LOG2_10);
  int index = (-NTS_GRISU_MIN_K + (int)approx - 1) / NTS_GRISU_STEP + 1;
  if (index < 0) {
    index = 0;
  }
  if (index >= (int)(sizeof nts_cached_powers / sizeof nts_cached_powers[0])) {
    return 0;
  }
  const NtsCachedPower cached = nts_cached_powers[index];
  NtsDiyFp ten = {cached.f, cached.e};

  const NtsDiyFp scaled_w = nts_diy_times(w, ten);
  const NtsDiyFp scaled_low = nts_diy_times(low, ten);
  const NtsDiyFp scaled_high = nts_diy_times(high, ten);

  int kappa;
  if (!nts_digits(scaled_low, scaled_w, scaled_high, buffer, length, &kappa)) {
    return 0;
  }
  *point = *length + kappa - cached.k;
  return 1;
}

#endif /* NTS_GRISU_H */
