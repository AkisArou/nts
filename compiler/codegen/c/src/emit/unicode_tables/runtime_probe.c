/* Include the actual runtime to compare its internal scalar/vector boundary.
 * The public conversion is independently checked against its scalar model;
 * Node's whole-code-point census checks the model and contextual answers. */
#include "nts_unicode.c"
#include <assert.h>
#include <fcntl.h>
#include <sys/mman.h>
#include <unistd.h>

static void spans(void) {
  uint16_t storage[80];
  uint32_t state = 0x12345678u;
  for (int lower = 0; lower <= 1; lower++) {
    for (unsigned offset = 0; offset < 8; offset++) {
      for (unsigned length = 0; length <= 64; length++) {
        for (unsigned stop = 0; stop <= length; stop++) {
          uint16_t *source = storage + offset;
          for (unsigned i = 0; i < length; i++) {
            state = state * 1664525u + 1013904223u;
            source[i] = (i & 1) ? (uint16_t)(0x4e00u + (state & 255u)) : ' ';
          }
          if (stop < length)
            source[stop] = lower ? 'A' : 'a';
          assert(nts_case_identity_span(source, 0, length, 0x4e00, 0x4eff,
                                        lower) ==
                 nts_case_identity_scalar(source, 0, length, 0x4e00, 0x4eff,
                                          lower));
        }
      }
    }
  }
  const size_t page = (size_t)sysconf(_SC_PAGESIZE);
  int fd = open("/dev/zero", O_RDWR);
  assert(fd >= 0);
  unsigned char *memory =
      mmap(NULL, page * 2, PROT_READ | PROT_WRITE, MAP_PRIVATE, fd, 0);
  assert(memory != MAP_FAILED);
  close(fd);
  assert(mprotect(memory + page, page, PROT_NONE) == 0);
  for (unsigned length = 0; length <= 64; length++) {
    uint16_t *source = (uint16_t *)(memory + page) - length;
    for (unsigned i = 0; i < length; i++)
      source[i] = 0x4e00;
    assert(nts_case_identity_span(source, 0, length, 0x4e00, 0x4eff, 0) ==
           length);
  }
  assert(munmap(memory, page * 2) == 0);
}

static void mapping(const uint16_t *units, uint32_t length, int wide,
                    int lower) {
  NtsString *source = nts_str_raw(length, wide);
  for (uint32_t i = 0; i < length; i++) {
    if (wide)
      NTS_ELEMENTS(source, uint16_t)[i] = units[i];
    else
      NTS_ELEMENTS(source, uint8_t)[i] = (uint8_t)units[i];
  }
  uint16_t expected[256];
  uint32_t written = 0;
  int changed = 0;
  const __nts_case_tables *tables =
      lower ? &__nts_case_lower_tables : &__nts_case_upper_tables;
  for (uint32_t at = 0; at < length;) {
    const NtsCaseMapping mapped = nts_case_cold(source, at, tables, lower);
    changed |= mapped.count != 1 || mapped.values[0] != mapped.point;
    for (int each = 0; each < mapped.count; each++) {
      uint32_t cp = mapped.values[each];
      if (cp > 0xffffu) {
        expected[written++] = (uint16_t)(0xd800u + ((cp - 0x10000u) >> 10));
        expected[written++] = (uint16_t)(0xdc00u + ((cp - 0x10000u) & 1023u));
      } else
        expected[written++] = (uint16_t)cp;
    }
    at += mapped.width;
  }
  size_t before = nts_live_count();
  NtsString *actual =
      lower ? nts_str_to_lower_case(source) : nts_str_to_upper_case(source);
  assert(actual->length == written);
  assert((actual == source) == !changed);
  assert(nts_live_count() == before + (changed ? 1u : 0u));
  for (uint32_t i = 0; i < written; i++) {
    uint16_t cp = (actual->flags & NTS_TWO_BYTE)
                      ? NTS_ELEMENTS(actual, uint16_t)[i]
                      : NTS_ELEMENTS(actual, uint8_t)[i];
    assert(cp == expected[i]);
  }
  nts_release(actual);
  /* A missing retain on the unchanged return is a use-after-free here. */
  assert(source->length == length);
  for (uint32_t i = 0; i < length; i++) {
    uint16_t original = wide ? NTS_ELEMENTS(source, uint16_t)[i]
                             : NTS_ELEMENTS(source, uint8_t)[i];
    assert(original == units[i]);
  }
  nts_release(source);
}

int main(void) {
  spans();
  /* An already written narrow prefix, followed by a widening or narrow unit.
   * These exercise the base-pointer handoff after local output stores. */
  static const uint16_t widening[] = {0xe9, 0xff};
  static const uint16_t narrow[] = {0xe9, 0xfd};
  mapping(widening, 2, 0, 0);
  mapping(narrow, 2, 0, 0);
  mapping(widening, 2, 1, 0);
  mapping(narrow, 2, 1, 0);
  static const uint16_t cold[] = {
      'A',    0x4e00, 0x4eff, 0x3a3,  0x301,  ' ',    0xdf, 0xff,
      0xb5,   0x153,  0x130,  0xd801, 0xdc00, 0xd800, 'B',  0xdc00,
      0xffff, 0x390,  0x1f80, 0x4e01, 'a',    0x4ffe};
  for (int lower = 0; lower <= 1; lower++) {
    for (unsigned length = 0; length <= 64; length++) {
      uint16_t units[64];
      for (unsigned shift = 0; shift < sizeof(cold) / sizeof(*cold); shift++) {
        for (unsigned i = 0; i < length; i++)
          units[i] = cold[(i + shift) % (sizeof(cold) / sizeof(*cold))];
        mapping(units, length, 1, lower);
      }
      for (unsigned cp = 0; cp < 256; cp++) {
        for (unsigned i = 0; i < length; i++)
          units[i] = (uint16_t)((cp + i) & 255u);
        mapping(units, length, 0, lower);
        mapping(units, length, 1, lower);
      }
      for (unsigned i = 0; i < length; i++)
        units[i] = (i & 1) ? 0x4e00 : ' ';
      mapping(units, length, 1, lower);
    }
  }
  assert(nts_live_count() == 0);
  puts("identity kernels agree");
  return 0;
}
