/* `JSON.parse(text) as T`: the scan a parser the compiler generates for `T`
 * reads (docs/foundations/json.md, "Reading").
 *
 * # Two halves, and this is the first
 *
 * The compiler generates one reader per static type: ordinary HIR that walks
 * a *tape* and builds `T`'s layout directly, with no intermediate tree
 * (`compiler/core/src/hir/lower/json_parse.rs`). This file makes the tape,
 * and answers the few questions about it that are byte work: what a key or a
 * string says, what a number is, and where in the document an entry sits.
 *
 * # The whole text is checked before any of it is read
 *
 * `nts_json_tape` validates the complete grammar first, so invalid text is a
 * `SyntaxError` whatever `T` says -- a reader never meets malformed text, and
 * a mismatch it reports (a `TypeError`) is always a mismatch in valid JSON.
 *
 * The scan is V8's grammar step for step (`deps/v8/src/json/json-parser.cc`,
 * `ParseJsonValueRecursive`, `ParseJsonObject`, `ParseJsonArray`,
 * `ParseJsonNumberAsDoubleOrSmi`, `ScanJsonString`, `ScanLiteral`), so the
 * first error it meets is the one node reports, at the same position, and
 * `nts_json_syntax_message` prints it in V8's words. It reads one unit at a
 * time, one-byte and two-byte text alike: this is nts's own scan, the one
 * non-ASCII text always takes.
 *
 * # No depth limit
 *
 * Nesting is an explicit stack on the heap, grown on demand, never the C
 * stack, so the only limit is memory (the JSON decision: "no nesting-depth
 * limit beyond memory").
 *
 * # The tape
 *
 * A `number[]`, so every backend reads it as an ordinary array: the compiler
 * has no managed array of 32-bit integers, which would halve it. The scan
 * writes into a growable buffer and copies it once into the array it hands
 * back, whose length it then knows. Four doubles of header, then three per
 * value, in document order:
 *
 *     [0]  1 when the text is JSON, 0 when it is not
 *     [1]  not JSON: the error (`Problem`); JSON: unused
 *     [2]  not JSON: its position in code units
 *     [3]  not JSON: the unit there, for the messages that quote it
 *
 *     object, array   kind, the index just past its last descendant, its
 *                     member or element count
 *     string          kind, its first unit (or -1 - that, when it holds an
 *                     escape), the index of its closing quote
 *     number          kind, its first unit, the unit after its last
 *     true/false/null kind, its first unit, the unit after its last
 *
 * An object's members are its key's string entry followed by its value's
 * entries; a duplicate key is kept, so the reader can take the last. Skipping
 * any value is one read: a container's second word, or three for a scalar.
 */

#ifndef _POSIX_C_SOURCE
#define _POSIX_C_SOURCE 200809L
#endif
#if defined(__APPLE__) && !defined(_DARWIN_C_SOURCE)
#define _DARWIN_C_SOURCE
#endif

#include "nts_runtime.h"

#include <stdio.h>
#include <stdlib.h>

NTS_RUNTIME_SYMBOLS_BEGIN

/* The kinds, as the generated readers test them (`json_parse.rs`, `Kind`). */
enum {
  NTS_JSON_OBJECT = 1,
  NTS_JSON_ARRAY = 2,
  NTS_JSON_STRING = 3,
  NTS_JSON_NUMBER = 4,
  NTS_JSON_TRUE = 5,
  NTS_JSON_FALSE = 6,
  NTS_JSON_NULL = 7,
};

/* Where the first value starts, and how wide every entry is. */
enum { NTS_JSON_HEAD = 4, NTS_JSON_ENTRY = 3 };

/* What went wrong, as V8 tells it. `NTS_JSON_TOKEN` is V8's
 * `ReportUnexpectedCharacter` (and `ReportUnexpectedToken` with no message of
 * its own), whose wording depends on the unit and the text; every other is
 * one `MessageTemplate` with a position. */
typedef enum {
  NTS_JSON_FINE = 0,
  NTS_JSON_END,
  NTS_JSON_TOKEN,
  NTS_JSON_UNTERMINATED_STRING,
  NTS_JSON_PROPERTY_NAME_OR_BRACE,
  NTS_JSON_COMMA_OR_BRACKET,
  NTS_JSON_COMMA_OR_BRACE,
  NTS_JSON_DOUBLE_QUOTED_NAME,
  NTS_JSON_EXPONENT,
  NTS_JSON_COLON,
  NTS_JSON_FRACTION,
  NTS_JSON_AFTER_JSON,
  NTS_JSON_BAD_ESCAPE,
  NTS_JSON_CONTROL,
  NTS_JSON_UNICODE_ESCAPE,
  NTS_JSON_MINUS,
} Problem;

/* The text's units, one-byte or two-byte, read one at a time. The scan is
 * written once and inlined twice, at a constant width, so neither copy tests
 * the width per unit. */
typedef struct {
  const void *units;
  uint32_t length;
  int wide;
} Text;

__attribute__((always_inline)) static inline uint32_t
nts_json_unit(const Text *text, uint32_t at) {
  return text->wide ? ((const uint16_t *)text->units)[at]
                    : ((const unsigned char *)text->units)[at];
}

static Text nts_json_text(const NtsString *s) {
  Text text;
  text.length = s->length;
  text.wide = (s->flags & NTS_TWO_BYTE) != 0;
  text.units = text.wide ? (const void *)NTS_ELEMENTS(s, const uint16_t)
                         : (const void *)NTS_ELEMENTS(s, const unsigned char);
  return text;
}

/* JSON's whitespace, and nothing else: not U+FEFF, not U+00A0. */
static inline bool nts_json_space(uint32_t unit) {
  return unit == ' ' || unit == '\t' || unit == '\n' || unit == '\r';
}

static inline bool nts_json_digit(uint32_t unit) {
  return unit >= '0' && unit <= '9';
}

static inline int nts_json_hex(uint32_t unit) {
  if (unit >= '0' && unit <= '9') {
    return (int)(unit - '0');
  }
  if (unit >= 'a' && unit <= 'f') {
    return (int)(unit - 'a' + 10);
  }
  if (unit >= 'A' && unit <= 'F') {
    return (int)(unit - 'A' + 10);
  }
  return -1;
}

/* V8's `NumberPart`: a unit that may continue a number. */
static inline bool nts_json_number_part(uint32_t unit) {
  return nts_json_digit(unit) || unit == '.' || unit == 'e' || unit == 'E' ||
         unit == '-' || unit == '+';
}

/* The tape being written, and the stack of open containers. */
typedef struct {
  double *items;
  size_t length;
  size_t capacity;
} Tape;

typedef struct {
  size_t entry;
  double count;
  bool object;
} Open;

static void nts_json_out_of_memory(void) {
  fprintf(stderr, NTS_REFUSED "out of memory scanning JSON text\n");
  abort();
}

static void nts_json_reserve(void **items, size_t *capacity, size_t wanted,
                             size_t size) {
  if (wanted <= *capacity) {
    return;
  }
  size_t grown = *capacity ? *capacity : 64u;
  while (grown < wanted) {
    grown *= 2u;
  }
  void *moved = realloc(*items, grown * size);
  if (!moved) {
    nts_json_out_of_memory();
  }
  *items = moved;
  *capacity = grown;
}

static size_t nts_json_entry(Tape *tape, double kind, double a, double b) {
  nts_json_reserve((void **)&tape->items, &tape->capacity,
                   tape->length + NTS_JSON_ENTRY, sizeof(double));
  size_t at = tape->length;
  tape->items[at] = kind;
  tape->items[at + 1] = a;
  tape->items[at + 2] = b;
  tape->length += NTS_JSON_ENTRY;
  return at;
}

/* The scan's answer: fine, or the first problem and where. */
typedef struct {
  Problem problem;
  uint32_t at;
} Verdict;

static inline Verdict nts_json_fails(Problem problem, uint32_t at) {
  Verdict verdict = {problem, at};
  return verdict;
}

static inline uint32_t nts_json_skip_space(const Text *text, uint32_t at) {
  while (at < text->length && nts_json_space(nts_json_unit(text, at))) {
    at++;
  }
  return at;
}

/* `ScanJsonString`, from the unit after the opening quote. On success `*at`
 * is past the closing quote and `*close` is its index. */
__attribute__((always_inline)) static inline Verdict
nts_json_scan_string(const Text *text, uint32_t *at, uint32_t *close,
                     bool *escaped) {
  uint32_t c = *at;
  for (;;) {
    if (c >= text->length) {
      return nts_json_fails(NTS_JSON_UNTERMINATED_STRING, text->length);
    }
    uint32_t unit = nts_json_unit(text, c);
    if (unit == '"') {
      *close = c;
      *at = c + 1u;
      return nts_json_fails(NTS_JSON_FINE, 0);
    }
    if (unit == '\\') {
      *escaped = true;
      c++;
      if (c >= text->length) {
        return nts_json_fails(NTS_JSON_END, c);
      }
      uint32_t escape = nts_json_unit(text, c);
      switch (escape) {
      case '"':
      case '\\':
      case '/':
      case 'b':
      case 'f':
      case 'n':
      case 'r':
      case 't':
        break;
      case 'u':
        for (int digit = 0; digit < 4; digit++) {
          c++;
          if (c >= text->length || nts_json_hex(nts_json_unit(text, c)) < 0) {
            return nts_json_fails(NTS_JSON_UNICODE_ESCAPE, c);
          }
        }
        break;
      default:
        /* V8 reads a unit past Latin-1 as an unexpected character, and any
         * other as a bad escape. */
        return nts_json_fails(
            escape > 0xFFu ? NTS_JSON_TOKEN : NTS_JSON_BAD_ESCAPE, c);
      }
      c++;
      continue;
    }
    if (unit < 0x20u) {
      return nts_json_fails(NTS_JSON_CONTROL, c);
    }
    c++;
  }
}

/* `ParseJsonNumberAsDoubleOrSmi`'s grammar, from its first unit. */
__attribute__((always_inline)) static inline Verdict
nts_json_scan_number(const Text *text, uint32_t *at) {
  uint32_t c = *at;
  const uint32_t n = text->length;
#define NTS_JSON_AT(i) ((i) < n ? nts_json_unit(text, (i)) : 0xFFFFFFFFu)
  bool negative = false;
  if (NTS_JSON_AT(c) == '-') {
    negative = true;
    c++;
  }
  if (NTS_JSON_AT(c) == '0') {
    c++;
    uint32_t next = NTS_JSON_AT(c);
    if (next <= 0xFFu && nts_json_number_part(next)) {
      if (nts_json_digit(next)) {
        return nts_json_fails(NTS_JSON_TOKEN, c);
      }
    } else if (!negative) {
      *at = c;
      return nts_json_fails(NTS_JSON_FINE, 0);
    }
  } else {
    uint32_t first = c;
    while (c < n && nts_json_digit(nts_json_unit(text, c))) {
      c++;
    }
    if (c == first) {
      return nts_json_fails(NTS_JSON_MINUS, c);
    }
  }
  if (NTS_JSON_AT(c) == '.') {
    c++;
    if (!nts_json_digit(NTS_JSON_AT(c))) {
      return nts_json_fails(NTS_JSON_FRACTION, c);
    }
    while (c < n && nts_json_digit(nts_json_unit(text, c))) {
      c++;
    }
  }
  uint32_t e = NTS_JSON_AT(c);
  if (e == 'e' || e == 'E') {
    c++;
    uint32_t sign = NTS_JSON_AT(c);
    if (sign == '-' || sign == '+') {
      c++;
    }
    if (!nts_json_digit(NTS_JSON_AT(c))) {
      return nts_json_fails(NTS_JSON_EXPONENT, c);
    }
    while (c < n && nts_json_digit(nts_json_unit(text, c))) {
      c++;
    }
  }
#undef NTS_JSON_AT
  *at = c;
  return nts_json_fails(NTS_JSON_FINE, 0);
}

/* `ScanLiteral`, from its first unit, which matched already. */
__attribute__((always_inline)) static inline Verdict
nts_json_scan_literal(const Text *text, uint32_t *at, const char *word,
                      uint32_t length) {
  uint32_t c = *at;
  for (uint32_t i = 1; i < length; i++) {
    if (c + i >= text->length) {
      return nts_json_fails(NTS_JSON_END, text->length);
    }
    if (nts_json_unit(text, c + i) != (unsigned char)word[i]) {
      return nts_json_fails(NTS_JSON_TOKEN, c + i);
    }
  }
  *at = c + length;
  return nts_json_fails(NTS_JSON_FINE, 0);
}

/* The whole scan: V8's grammar, writing the tape as it goes. */
__attribute__((always_inline)) static inline Verdict
nts_json_scan_text(const Text *text, Tape *tape, Open **stack,
                   size_t *stack_capacity) {
  size_t depth = 0;
  uint32_t c = 0;
  Problem first_key = NTS_JSON_PROPERTY_NAME_OR_BRACE;
  Verdict verdict;
value:
  c = nts_json_skip_space(text, c);
  if (c >= text->length) {
    return nts_json_fails(NTS_JSON_END, c);
  }
  switch (nts_json_unit(text, c)) {
  case '"': {
    uint32_t start = c + 1u;
    uint32_t close = 0;
    bool escaped = false;
    c = start;
    verdict = nts_json_scan_string(text, &c, &close, &escaped);
    if (verdict.problem != NTS_JSON_FINE) {
      return verdict;
    }
    nts_json_entry(tape, NTS_JSON_STRING,
                   escaped ? -1.0 - (double)start : (double)start,
                   (double)close);
    goto after;
  }
  case '-':
  case '0':
  case '1':
  case '2':
  case '3':
  case '4':
  case '5':
  case '6':
  case '7':
  case '8':
  case '9': {
    uint32_t start = c;
    verdict = nts_json_scan_number(text, &c);
    if (verdict.problem != NTS_JSON_FINE) {
      return verdict;
    }
    nts_json_entry(tape, NTS_JSON_NUMBER, (double)start, (double)c);
    goto after;
  }
  case 't':
  case 'f':
  case 'n': {
    uint32_t start = c;
    uint32_t unit = nts_json_unit(text, c);
    const char *word = unit == 't' ? "true" : unit == 'f' ? "false" : "null";
    verdict = nts_json_scan_literal(text, &c, word, (uint32_t)strlen(word));
    if (verdict.problem != NTS_JSON_FINE) {
      return verdict;
    }
    nts_json_entry(tape,
                   unit == 't'   ? NTS_JSON_TRUE
                   : unit == 'f' ? NTS_JSON_FALSE
                                 : NTS_JSON_NULL,
                   (double)start, (double)c);
    goto after;
  }
  case '{':
  case '[': {
    bool object = nts_json_unit(text, c) == '{';
    size_t entry = nts_json_entry(
        tape, object ? NTS_JSON_OBJECT : NTS_JSON_ARRAY, 0.0, 0.0);
    c = nts_json_skip_space(text, c + 1u);
    if (c < text->length && nts_json_unit(text, c) == (object ? '}' : ']')) {
      c++;
      tape->items[entry + 1] = (double)tape->length;
      goto after;
    }
    nts_json_reserve((void **)stack, stack_capacity, depth + 1u, sizeof(Open));
    (*stack)[depth].entry = entry;
    (*stack)[depth].count = 1.0;
    (*stack)[depth].object = object;
    depth++;
    if (object) {
      first_key = NTS_JSON_PROPERTY_NAME_OR_BRACE;
      goto key;
    }
    goto value;
  }
  default:
    return nts_json_fails(NTS_JSON_TOKEN, c);
  }

key:
  c = nts_json_skip_space(text, c);
  if (c >= text->length || nts_json_unit(text, c) != '"') {
    return nts_json_fails(first_key, c);
  }
  {
    uint32_t start = c + 1u;
    uint32_t close = 0;
    bool escaped = false;
    c = start;
    verdict = nts_json_scan_string(text, &c, &close, &escaped);
    if (verdict.problem != NTS_JSON_FINE) {
      return verdict;
    }
    nts_json_entry(tape, NTS_JSON_STRING,
                   escaped ? -1.0 - (double)start : (double)start,
                   (double)close);
  }
  c = nts_json_skip_space(text, c);
  if (c >= text->length || nts_json_unit(text, c) != ':') {
    return nts_json_fails(NTS_JSON_COLON, c);
  }
  c++;
  goto value;

after:
  if (depth == 0) {
    c = nts_json_skip_space(text, c);
    if (c < text->length) {
      return nts_json_fails(NTS_JSON_AFTER_JSON, c);
    }
    return nts_json_fails(NTS_JSON_FINE, 0);
  }
  {
    Open *open = &(*stack)[depth - 1u];
    c = nts_json_skip_space(text, c);
    uint32_t unit = c < text->length ? nts_json_unit(text, c) : 0u;
    if (unit == ',') {
      c++;
      open->count += 1.0;
      if (open->object) {
        first_key = NTS_JSON_DOUBLE_QUOTED_NAME;
        goto key;
      }
      goto value;
    }
    if (c < text->length && unit == (open->object ? '}' : ']')) {
      c++;
      tape->items[open->entry + 1] = (double)tape->length;
      tape->items[open->entry + 2] = open->count;
      depth--;
      goto after;
    }
    return nts_json_fails(
        open->object ? NTS_JSON_COMMA_OR_BRACE : NTS_JSON_COMMA_OR_BRACKET, c);
  }
}

static Verdict nts_json_scan_narrow(const Text *text, Tape *tape, Open **stack,
                                    size_t *capacity) {
  Text narrow = *text;
  narrow.wide = 0;
  return nts_json_scan_text(&narrow, tape, stack, capacity);
}

static Verdict nts_json_scan_wide(const Text *text, Tape *tape, Open **stack,
                                  size_t *capacity) {
  Text wide = *text;
  wide.wide = 1;
  return nts_json_scan_text(&wide, tape, stack, capacity);
}

NtsArray *nts_json_tape(const NtsString *source) {
  const Text text = nts_json_text(source);
  Tape tape = {NULL, 0, 0};
  nts_json_reserve((void **)&tape.items, &tape.capacity, 64u, sizeof(double));
  tape.length = NTS_JSON_HEAD;
  Open *stack = NULL;
  size_t stack_capacity = 0;
  const Verdict verdict =
      text.wide ? nts_json_scan_wide(&text, &tape, &stack, &stack_capacity)
                : nts_json_scan_narrow(&text, &tape, &stack, &stack_capacity);
  free(stack);
  NtsArray *out;
  if (verdict.problem == NTS_JSON_FINE) {
    out = nts_array_of_numbers((double)tape.length);
    double *items = NTS_ITEMS(out, double);
    memcpy(items + NTS_JSON_HEAD, tape.items + NTS_JSON_HEAD,
           (tape.length - NTS_JSON_HEAD) * sizeof(double));
    items[0] = 1.0;
  } else {
    out = nts_array_of_numbers((double)NTS_JSON_HEAD);
    double *items = NTS_ITEMS(out, double);
    items[0] = 0.0;
    items[1] = (double)verdict.problem;
    items[2] = (double)verdict.at;
    items[3] = verdict.at < text.length
                   ? (double)nts_json_unit(&text, verdict.at)
                   : -1.0;
  }
  free(tape.items);
  return out;
}

/* # Messages
 *
 * Built into a growable buffer of UTF-16 units, so a unit or a stretch of a
 * two-byte text goes in as it is, and made a string once. */
typedef struct {
  uint16_t *units;
  size_t length;
  size_t capacity;
} Units;

static void nts_json_put(Units *out, uint32_t unit) {
  nts_json_reserve((void **)&out->units, &out->capacity, out->length + 1u,
                   sizeof(uint16_t));
  out->units[out->length++] = (uint16_t)unit;
}

static void nts_json_put_ascii(Units *out, const char *text) {
  for (; *text; text++) {
    nts_json_put(out, (unsigned char)*text);
  }
}

static void nts_json_put_number(Units *out, uint32_t value) {
  char digits[16];
  snprintf(digits, sizeof digits, "%u", value);
  nts_json_put_ascii(out, digits);
}

static void nts_json_put_span(Units *out, const Text *text, uint32_t from,
                              uint32_t to) {
  for (uint32_t at = from; at < to; at++) {
    nts_json_put(out, nts_json_unit(text, at));
  }
}

static NtsString *nts_json_finish(Units *out) {
  NtsString *made = nts_str_alloc(out->units, (uint32_t)out->length);
  free(out->units);
  return made;
}

/* V8's `CalculateFileLocation`: JSON's own line breaks, `\r\n` as one. */
static void nts_json_put_location(Units *out, const Text *text, uint32_t pos) {
  uint32_t line = 1;
  uint32_t line_start = 0;
  uint32_t at = 0;
  for (; at < pos; at++) {
    uint32_t unit = nts_json_unit(text, at);
    if (unit == '\r' && at + 1u < pos && nts_json_unit(text, at + 1u) == '\n') {
      at++;
      unit = '\n';
    }
    if (unit == '\r' || unit == '\n') {
      line++;
      line_start = at + 1u;
    }
  }
  nts_json_put_ascii(out, " at position ");
  nts_json_put_number(out, pos);
  nts_json_put_ascii(out, " (line ");
  nts_json_put_number(out, line);
  nts_json_put_ascii(out, " column ");
  nts_json_put_number(out, 1u + (at - line_start));
  nts_json_put(out, ')');
}

/* V8's `IsSpecialString`: the four texts a stray `String(x)` makes. */
static bool nts_json_special(const Text *text) {
  static const char *const special[] = {"[object Object]", "undefined",
                                        "Infinity", "NaN"};
  for (size_t i = 0; i < sizeof special / sizeof special[0]; i++) {
    size_t length = strlen(special[i]);
    if (length != text->length) {
      continue;
    }
    size_t at = 0;
    while (at < length &&
           nts_json_unit(text, (uint32_t)at) == (unsigned char)special[i][at]) {
      at++;
    }
    if (at == length) {
      return true;
    }
  }
  return false;
}

NtsString *nts_json_syntax_message(const NtsString *source,
                                   const NtsArray *tape) {
  const Text text = nts_json_text(source);
  const double *items = NTS_ITEMS(tape, const double);
  const Problem problem = (Problem)(int)items[1];
  const uint32_t pos = (uint32_t)items[2];
  const double unit = items[3];
  Units out = {NULL, 0, 0};
  const char *template = NULL;
  switch (problem) {
  case NTS_JSON_FINE:
  case NTS_JSON_END:
    nts_json_put_ascii(&out, "Unexpected end of JSON input");
    return nts_json_finish(&out);
  case NTS_JSON_TOKEN:
    break;
  case NTS_JSON_UNTERMINATED_STRING:
    template = "Unterminated string in JSON";
    break;
  case NTS_JSON_PROPERTY_NAME_OR_BRACE:
    template = "Expected property name or '}' in JSON";
    break;
  case NTS_JSON_COMMA_OR_BRACKET:
    template = "Expected ',' or ']' after array element in JSON";
    break;
  case NTS_JSON_COMMA_OR_BRACE:
    template = "Expected ',' or '}' after property value in JSON";
    break;
  case NTS_JSON_DOUBLE_QUOTED_NAME:
    template = "Expected double-quoted property name in JSON";
    break;
  case NTS_JSON_EXPONENT:
    template = "Exponent part is missing a number in JSON";
    break;
  case NTS_JSON_COLON:
    template = "Expected ':' after property name in JSON";
    break;
  case NTS_JSON_FRACTION:
    template = "Unterminated fractional number in JSON";
    break;
  case NTS_JSON_AFTER_JSON:
    template = "Unexpected non-whitespace character after JSON";
    break;
  case NTS_JSON_BAD_ESCAPE:
    template = "Bad escaped character in JSON";
    break;
  case NTS_JSON_CONTROL:
    template = "Bad control character in string literal in JSON";
    break;
  case NTS_JSON_UNICODE_ESCAPE:
    template = "Bad Unicode escape in JSON";
    break;
  case NTS_JSON_MINUS:
    template = "No number after minus sign in JSON";
    break;
  }
  if (template) {
    nts_json_put_ascii(&out, template);
    nts_json_put_location(&out, &text, pos);
    return nts_json_finish(&out);
  }
  /* `LookUpErrorMessageForJsonToken`: a number or a string by its token, and
   * anything else quoted with the text around it. */
  const uint32_t at = unit < 0.0 ? 0u : (uint32_t)unit;
  if (unit < 0.0) {
    nts_json_put_ascii(&out, "Unexpected end of JSON input");
    return nts_json_finish(&out);
  }
  if (at == '-' || nts_json_digit(at) || at == '"') {
    nts_json_put_ascii(&out, at == '"' ? "Unexpected string in JSON"
                                       : "Unexpected number in JSON");
    nts_json_put_location(&out, &text, pos);
    return nts_json_finish(&out);
  }
  if (nts_json_special(&text)) {
    nts_json_put(&out, '"');
    nts_json_put_span(&out, &text, 0, text.length);
    nts_json_put_ascii(&out, "\" is not valid JSON");
    return nts_json_finish(&out);
  }
  /* `GetErrorMessageWithEllipses`: ten units either side, from 21 on. */
  const uint32_t context = 10;
  nts_json_put_ascii(&out, "Unexpected token '");
  nts_json_put(&out, at);
  nts_json_put_ascii(&out, "', ");
  if (text.length >= 2u * context + 1u) {
    if (pos < context) {
      nts_json_put(&out, '"');
      nts_json_put_span(&out, &text, 0, pos + context);
      nts_json_put_ascii(&out, "\"... is not valid JSON");
    } else if (pos < text.length - context) {
      nts_json_put_ascii(&out, "...\"");
      nts_json_put_span(&out, &text, pos - context, pos + context);
      nts_json_put_ascii(&out, "\"... is not valid JSON");
    } else {
      nts_json_put_ascii(&out, "...\"");
      nts_json_put_span(&out, &text, pos - context, text.length);
      nts_json_put_ascii(&out, "\" is not valid JSON");
    }
  } else {
    nts_json_put(&out, '"');
    nts_json_put_span(&out, &text, 0, text.length);
    nts_json_put_ascii(&out, "\" is not valid JSON");
  }
  return nts_json_finish(&out);
}

/* # Reading entries */

static inline const double *nts_json_items(const NtsArray *tape) {
  return NTS_ITEMS(tape, const double);
}

/* An entry's string span: its first unit, the closing quote, and whether it
 * holds an escape. */
static void nts_json_span(const NtsArray *tape, uint32_t entry, uint32_t *start,
                          uint32_t *end, bool *escaped) {
  const double *items = nts_json_items(tape);
  double first = items[entry + 1];
  *escaped = first < 0.0;
  *start = (uint32_t)(*escaped ? -1.0 - first : first);
  *end = (uint32_t)items[entry + 2];
}

/* The units a validated string means, into `out` (room for `end - start`):
 * how many. An escape is never longer than what it stands for. */
static uint32_t nts_json_decode(const Text *text, uint32_t start, uint32_t end,
                                uint16_t *out) {
  uint32_t length = 0;
  for (uint32_t at = start; at < end; at++) {
    uint32_t unit = nts_json_unit(text, at);
    if (unit != '\\') {
      out[length++] = (uint16_t)unit;
      continue;
    }
    at++;
    switch (nts_json_unit(text, at)) {
    case 'b':
      out[length++] = '\b';
      break;
    case 'f':
      out[length++] = '\f';
      break;
    case 'n':
      out[length++] = '\n';
      break;
    case 'r':
      out[length++] = '\r';
      break;
    case 't':
      out[length++] = '\t';
      break;
    case 'u': {
      uint32_t value = 0;
      for (int digit = 0; digit < 4; digit++) {
        value = value * 16u +
                (uint32_t)nts_json_hex(nts_json_unit(text, at + 1u + digit));
      }
      at += 4u;
      out[length++] = (uint16_t)value;
      break;
    }
    default:
      out[length++] = (uint16_t)nts_json_unit(text, at);
      break;
    }
  }
  return length;
}

NtsString *nts_json_string(const NtsString *source, const NtsArray *tape,
                           double at) {
  const Text text = nts_json_text(source);
  uint32_t start, end;
  bool escaped;
  nts_json_span(tape, (uint32_t)at, &start, &end, &escaped);
  const uint32_t span = end - start;
  if (!escaped && !text.wide) {
    NtsString *made = nts_str_raw(span, 0);
    memcpy(NTS_ELEMENTS(made, unsigned char),
           (const unsigned char *)text.units + start, span);
    return made;
  }
  if (!escaped) {
    return nts_str_alloc((const uint16_t *)text.units + start, span);
  }
  uint16_t stack[256];
  uint16_t *units = span <= 256u ? stack : malloc((size_t)span * 2u);
  if (!units) {
    nts_json_out_of_memory();
  }
  const uint32_t length = nts_json_decode(&text, start, end, units);
  NtsString *made = nts_str_alloc(units, length);
  if (units != stack) {
    free(units);
  }
  return made;
}

/* Whether the key at `entry` is the `length` units at `key`. */
static bool nts_json_key_is(const Text *text, uint32_t start, uint32_t end,
                            const uint16_t *decoded, uint32_t decoded_length,
                            const NtsString *keys, uint32_t key,
                            uint32_t length) {
  const bool wide = (keys->flags & NTS_TWO_BYTE) != 0;
#define NTS_JSON_KEY(i)                                                        \
  (wide ? NTS_ELEMENTS(keys, const uint16_t)[key + (i)]                        \
        : NTS_ELEMENTS(keys, const unsigned char)[key + (i)])
  if (decoded) {
    if (decoded_length != length) {
      return false;
    }
    for (uint32_t i = 0; i < length; i++) {
      if (decoded[i] != NTS_JSON_KEY(i)) {
        return false;
      }
    }
    return true;
  }
  if (end - start != length) {
    return false;
  }
  for (uint32_t i = 0; i < length; i++) {
    if (nts_json_unit(text, start + i) != NTS_JSON_KEY(i)) {
      return false;
    }
  }
  return true;
#undef NTS_JSON_KEY
}

double nts_json_key_index(const NtsString *source, const NtsArray *tape,
                          double at, const NtsString *keys, double hint) {
  const Text text = nts_json_text(source);
  uint32_t start, end;
  bool escaped;
  nts_json_span(tape, (uint32_t)at, &start, &end, &escaped);
  uint16_t stack[64];
  uint16_t *decoded = NULL;
  uint32_t decoded_length = 0;
  if (escaped) {
    const uint32_t span = end - start;
    decoded = span <= 64u ? stack : malloc((size_t)span * 2u);
    if (!decoded) {
      nts_json_out_of_memory();
    }
    decoded_length = nts_json_decode(&text, start, end, decoded);
  }
  /* The table: each key as its length, one unit, then its units. */
  const bool wide = (keys->flags & NTS_TWO_BYTE) != 0;
  double found = -1.0;
  uint32_t ordinal = 0;
  const uint32_t wanted = hint >= 0.0 ? (uint32_t)hint : UINT32_MAX;
  /* The hint first: the member a reader expects next, in declaration order,
   * is the one a document written by `JSON.stringify` of the same type has. */
  for (int pass = 0; pass < 2 && found < 0.0; pass++) {
    ordinal = 0;
    for (uint32_t i = 0; i < keys->length; ordinal++) {
      const uint32_t length = wide ? NTS_ELEMENTS(keys, const uint16_t)[i]
                                   : NTS_ELEMENTS(keys, const unsigned char)[i];
      const bool asked = pass == 0 ? ordinal == wanted : ordinal != wanted;
      if (asked && nts_json_key_is(&text, start, end, decoded, decoded_length,
                                   keys, i + 1u, length)) {
        found = (double)ordinal;
        break;
      }
      i += 1u + length;
    }
  }
  if (decoded && decoded != stack) {
    free(decoded);
  }
  return found;
}

/* # Mismatches
 *
 * Only on the failing path, so none of this costs a document that matches:
 * the path is found again from the root. */

static inline uint32_t nts_json_next(const double *items, uint32_t entry) {
  const double kind = items[entry];
  return kind == NTS_JSON_OBJECT || kind == NTS_JSON_ARRAY
             ? (uint32_t)items[entry + 1]
             : entry + NTS_JSON_ENTRY;
}

static bool nts_json_identifier(const uint16_t *units, uint32_t length) {
  if (length == 0) {
    return false;
  }
  for (uint32_t i = 0; i < length; i++) {
    uint16_t unit = units[i];
    bool letter = (unit >= 'a' && unit <= 'z') ||
                  (unit >= 'A' && unit <= 'Z') || unit == '_' || unit == '$';
    if (!letter && !(i > 0 && nts_json_digit(unit))) {
      return false;
    }
  }
  return true;
}

/* `$`, then `.name`, `["odd name"]` or `[3]` down to `target`. */
static void nts_json_put_path(Units *out, const Text *text,
                              const NtsArray *tape, uint32_t target) {
  const double *items = nts_json_items(tape);
  nts_json_put(out, '$');
  uint32_t entry = NTS_JSON_HEAD;
  while (entry != target) {
    const double kind = items[entry];
    const uint32_t end = (uint32_t)items[entry + 1];
    uint32_t child = entry + NTS_JSON_ENTRY;
    const uint32_t from = entry;
    if (kind == NTS_JSON_OBJECT) {
      while (child < end) {
        const uint32_t value = child + NTS_JSON_ENTRY;
        const uint32_t after = nts_json_next(items, value);
        if (target >= value && target < after) {
          uint32_t start, close;
          bool escaped;
          nts_json_span(tape, child, &start, &close, &escaped);
          uint16_t *units = malloc((size_t)(close - start + 1u) * 2u);
          if (!units) {
            nts_json_out_of_memory();
          }
          const uint32_t length = nts_json_decode(text, start, close, units);
          if (nts_json_identifier(units, length)) {
            nts_json_put(out, '.');
            for (uint32_t i = 0; i < length; i++) {
              nts_json_put(out, units[i]);
            }
          } else {
            NtsString *name = nts_str_alloc(units, length);
            NtsString *quoted = nts_json_quote(name);
            const Text written = nts_json_text(quoted);
            nts_json_put(out, '[');
            nts_json_put_span(out, &written, 0, written.length);
            nts_json_put(out, ']');
            nts_release((NtsHeader *)quoted);
            nts_release((NtsHeader *)name);
          }
          free(units);
          entry = value;
          break;
        }
        child = after;
      }
    } else {
      uint32_t index = 0;
      while (child < end) {
        const uint32_t after = nts_json_next(items, child);
        if (target >= child && target < after) {
          nts_json_put(out, '[');
          nts_json_put_number(out, index);
          nts_json_put(out, ']');
          entry = child;
          break;
        }
        child = after;
        index++;
      }
    }
    /* A target inside no child of a container is not an entry of this tape:
     * the reader's own defect, never a document's. */
    if (entry == from) {
      fprintf(stderr, NTS_REFUSED "a JSON tape entry outside its document\n");
      abort();
    }
  }
}

static const char *nts_json_kind_name(double kind) {
  switch ((int)kind) {
  case NTS_JSON_OBJECT:
    return "an object";
  case NTS_JSON_ARRAY:
    return "an array";
  case NTS_JSON_STRING:
    return "a string";
  case NTS_JSON_NUMBER:
    return "a number";
  case NTS_JSON_TRUE:
  case NTS_JSON_FALSE:
    return "a boolean";
  default:
    return "null";
  }
}

static void nts_json_put_string(Units *out, const NtsString *s) {
  const Text text = nts_json_text(s);
  nts_json_put_span(out, &text, 0, text.length);
}

NtsString *nts_json_mismatch(const NtsString *source, const NtsArray *tape,
                             double at, const NtsString *expected) {
  const Text text = nts_json_text(source);
  Units out = {NULL, 0, 0};
  nts_json_put_path(&out, &text, tape, (uint32_t)at);
  nts_json_put_ascii(&out, ": expected ");
  nts_json_put_string(&out, expected);
  nts_json_put_ascii(&out, ", found ");
  nts_json_put_ascii(&out,
                     nts_json_kind_name(nts_json_items(tape)[(uint32_t)at]));
  return nts_json_finish(&out);
}

NtsString *nts_json_missing(const NtsString *source, const NtsArray *tape,
                            double at, const NtsString *key) {
  const Text text = nts_json_text(source);
  Units out = {NULL, 0, 0};
  nts_json_put_path(&out, &text, tape, (uint32_t)at);
  nts_json_put_ascii(&out, ": missing the property ");
  NtsString *quoted = nts_json_quote(key);
  nts_json_put_string(&out, quoted);
  nts_release((NtsHeader *)quoted);
  return nts_json_finish(&out);
}

NTS_RUNTIME_SYMBOLS_END
