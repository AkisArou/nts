/* A printer's successful prefix must not consume its throwing result or call
 * the next printer. The Node oracle is:
 *
 * const trace = [];
 * const item = (name, fails) => ({ toString() {
 *   trace.push(name); if (fails) throw payload; return name;
 * }});
 * const xs = [item('a', false), item('b', true), item('c', false)];
 * try { String(xs); } catch (caught) { assert(caught === payload); }
 * assert(trace.join('') === 'ab');
 * // Disable that one throw, and repeat on the very same arrays:
 * assert(String(xs) === 'a,b,c'); assert(trace.join('') === 'ababc');
 *
 * A descriptor below stands for the compiled raising entry, whose existing
 * contract is a pending erased value and a null string placeholder. */
#include "nts_runtime.h"
#include "nts_test_host.h"
#include <stdio.h>

typedef struct Item {
  NtsHeader header;
  char name;
  bool fails;
} Item;

static unsigned failures;
static unsigned calls;
static unsigned over_pending;
static char trace[16];
static NtsValue payload;

static void expect(const char *what, bool holds) {
  printf("%s %s\n", holds ? "ok " : "FAIL", what);
  failures += !holds;
}

static NtsHeader *print_item(const NtsHeader *object) {
  const Item *item = (const Item *)object;
  over_pending += nts_raising() != 0;
  trace[calls++] = item->name;
  if (item->fails) {
    nts_value_retain(payload);
    nts_raise(payload);
    return NULL;
  }
  return (NtsHeader *)nts_string_from_utf8(&item->name, 1);
}

static NtsHeader *print_array(const NtsHeader *object) {
  return (NtsHeader *)nts_array_to_string(object);
}

static const NtsDescriptor item_descriptor = {
    .kind = NTS_KIND_OBJECT,
    .size = sizeof(Item),
    .name = "Item",
    .to_string = print_item,
};
static const NtsDescriptor reference_array = {
    .kind = NTS_KIND_ARRAY,
    .size = sizeof(void *),
    .references = 1,
    .cyclic = 1,
    .name = "Item[]",
    .element = NTS_ARRAY_REFERENCE,
    .to_string = print_array,
};
static const NtsDescriptor value_array = {
    .kind = NTS_KIND_ARRAY,
    .size = sizeof(NtsValue),
    .cyclic = 1,
    .name = "any[]",
    .erased = 1,
    .element = NTS_ARRAY_VALUE,
    .to_string = print_array,
};

static NtsValue object_value(NtsHeader *object) {
  return nts_value_of_reference(object, NTS_TAG_OBJECT);
}

static void store(NtsArray *array, unsigned at, NtsHeader *object,
                  bool erased) {
  if (erased) {
    NTS_ITEMS(array, NtsValue)[at] = object_value(object);
  } else {
    NTS_ITEMS(array, NtsHeader *)[at] = object;
  }
}

static void one(bool erased, bool nested, NtsValue thrown) {
  size_t baseline = nts_live_count();
  payload = thrown;
  calls = over_pending = 0;
  const NtsDescriptor *descriptor = erased ? &value_array : &reference_array;
  NtsArray *array = nts_array_new(descriptor, 3);
  Item *middle = NULL;
  for (unsigned at = 0; at < 3; at++) {
    Item *item = (Item *)nts_object_new(&item_descriptor);
    item->name = (char)('a' + at);
    item->fails = false;
    store(array, at, (NtsHeader *)item, erased);
    if (at == 1) {
      middle = item;
    }
  }
  NtsArray *outer = array;
  if (nested) {
    outer = nts_array_new(descriptor, 1);
    store(outer, 0, (NtsHeader *)array, erased);
  }
  NtsString *text = nts_value_to_string(object_value((NtsHeader *)outer));
  NtsString *expected = nts_string_from_utf8("a,b,c", 5);
  expect("control array with no throwing printer spells all three elements",
         text && nts_string_eq(text, expected) && calls == 3 && !nts_raising());
  nts_release((NtsHeader *)text);
  calls = over_pending = 0;
  middle->fails = true;
  fflush(stdout);
  text = nts_value_to_string(object_value((NtsHeader *)outer));
  expect("throwing array forwards its null placeholder", text == NULL);
  expect("throwing array preserves the pending flag", nts_raising() != 0);
  expect("only the prefix and throwing middle printers ran",
         calls == 2 && trace[0] == 'a' && trace[1] == 'b');
  NtsValue caught = nts_raise_take();
  expect("array forwards the exact original payload",
         nts_value_strict_eq(caught, thrown));
  nts_value_release(caught);
  middle->fails = false;
  text = nts_value_to_string(object_value((NtsHeader *)outer));
  expect("the same array can print after its caller takes the throw",
         text != NULL && nts_string_eq(text, expected));
  expect("the retry runs all three printers with a clear pending flag",
         !nts_raising() && !over_pending && calls == 5 && trace[2] == 'a' &&
             trace[3] == 'b' && trace[4] == 'c');
  nts_release((NtsHeader *)expected);
  nts_release((NtsHeader *)text);
  nts_release((NtsHeader *)outer);
  nts_collect_cycles();
  expect("nested join cleanup releases its completed prefix and elements",
         nts_live_count() == baseline);
}

int main(void) {
  nts_test_host_install();
  NtsHeader *object = nts_object_new(&item_descriptor);
  NtsString *string = nts_string_from_utf8("payload", 7);
  const NtsValue payloads[] = {
      nts_value_of_undefined(), nts_value_of_null(), nts_value_of_number(22),
      nts_value_of_reference((NtsHeader *)string, NTS_TAG_STRING),
      object_value(object)};
  for (unsigned at = 0; at < sizeof payloads / sizeof *payloads; at++) {
    for (unsigned erased = 0; erased < 2; erased++) {
      one(erased, false, payloads[at]);
      one(erased, true, payloads[at]);
    }
  }
  nts_release(object);
  nts_release((NtsHeader *)string);
  nts_collect_cycles();
  expect("all printer fixtures release their owned payloads",
         nts_live_count() == 0);
  return failures ? 1 : 0;
}
