/* A symbol is an interned cell whose address is its identity.
 *
 * That is the whole representation, and this suite is the argument that it is
 * enough. Every property JavaScript asks of symbols is checked here against
 * pointer comparison and nothing else -- no description is consulted, no table
 * is searched, and the map cases pass with no symbol-specific code in the map
 * at all, because `nts_hash_key` already hashes an unrecognised reference by
 * its pointer and `nts_key_eq` already compares one by its pointer.
 *
 * The reason to write it down: those two fallbacks were general on purpose and
 * are now load-bearing for a type they were not written for. A change that made
 * either of them stricter would break symbols as map keys and nothing else.
 */
#include <stdio.h>
#include <string.h>

#include "nts_runtime.h"

static int failures;
static int checks;

static void ok(const char *what, int holds) {
  checks++;
  if (holds) {
    printf("ok %s\n", what);
    return;
  }
  printf("FAIL %s\n", what);
  failures++;
}

static NtsString *text(const char *bytes) {
  return nts_string_from_utf8(bytes, strlen(bytes));
}

static NtsValue symbol_value(NtsSymbol *s) {
  return nts_value_of_reference((NtsHeader *)s, NTS_TAG_SYMBOL);
}

static int says(NtsString *s, const char *expected) {
  NtsString *want = text(expected);
  return nts_string_eq(s, want);
}

/* Identity is the address, so two symbols made the same way differ. */
static void a_fresh_symbol_is_its_own_identity(void) {
  NtsSymbol *a = nts_symbol_new(text("a"));
  NtsSymbol *b = nts_symbol_new(text("a"));
  ok("two symbols with one description are different", a != b);
  NtsSymbol *same = a;
  ok("and each is itself", same == a);
  ok("a symbol answers `symbol` to typeof",
     says(nts_tag_name(NTS_TAG_SYMBOL), "symbol"));
  /* The tag is inside the reference range, so the tracer, retain and release
   * all reach a symbol without knowing what one is. */
  ok("a symbol is a reference", NTS_TAG_IS_REFERENCE(NTS_TAG_SYMBOL));
  /* And outside the object range, or `typeof sym` would answer "object". */
  ok("a symbol is not an object", NTS_TAG_SYMBOL < NTS_TAG_OBJECT);
  /* A value that arrives without a tag gets one from what it is, and a symbol
   * has to be told apart from an object there too -- otherwise a symbol read
   * back out of a promise, which is the path that has no compile-time tag,
   * answers `"object"` to `typeof`. */
  ok("a symbol read from its cell is tagged a symbol",
     nts_tag_of_reference((NtsHeader *)a) == NTS_TAG_SYMBOL);
  ok("and a string is still tagged a string",
     nts_tag_of_reference((NtsHeader *)text("s")) == NTS_TAG_STRING);
}

/* The registry hands back what it already made. */
static void a_registered_symbol_is_one_symbol(void) {
  NtsSymbol *first = nts_symbol_for(text("shared"));
  NtsSymbol *again = nts_symbol_for(text("shared"));
  ok("Symbol.for gives one symbol per key", first == again);

  NtsSymbol *other = nts_symbol_for(text("elsewhere"));
  ok("and different symbols for different keys", first != other);

  /* The distinction that makes the registry worth having at all. */
  NtsSymbol *unregistered = nts_symbol_new(text("shared"));
  ok("an unregistered symbol is not the registered one", unregistered != first);

  ok("keyFor answers for a registered symbol",
     says(nts_symbol_key_for(first), "shared"));
  ok("and answers nothing for one that was not registered",
     nts_symbol_key_for(unregistered) == 0);
}

/* The description is for printing and takes no part in identity. */
static void the_description_is_not_the_identity(void) {
  NtsSymbol *described = nts_symbol_new(text("tag"));
  ok("a description reads back",
     says(nts_symbol_description(described), "tag"));
  ok("String(sym) wraps it",
     says(nts_symbol_to_string(described), "Symbol(tag)"));

  NtsSymbol *bare = nts_symbol_new(0);
  ok("a symbol may have none", nts_symbol_description(bare) == 0);
  ok("and prints as the empty parenthesis",
     says(nts_symbol_to_string(bare), "Symbol()"));
}

/* A map keyed by symbols, with no symbol-specific code in the map.
 *
 * `NTS_KEY_REFERENCE` is the homogeneous case and `NTS_KEY_ERASED` the mixed
 * one; both are exercised, because `Map<string | symbol, V>` -- which is what
 * `EventEmitter._events` is and what 318 refusal sites in `runtime/node` are
 * waiting on -- takes the second. */
static void a_symbol_keyed_map(void) {
  NtsSymbol *one = nts_symbol_new(text("one"));
  NtsSymbol *two = nts_symbol_new(text("two"));

  NtsMap *by_reference = nts_map_new(3.0 /* NTS_KEY_REFERENCE */);
  nts_map_set(by_reference, symbol_value(one), nts_value_of_number(1));
  nts_map_set(by_reference, symbol_value(two), nts_value_of_number(2));
  ok("two symbols are two keys", by_reference->header.length == 2);
  ok("and each finds its own value",
     nts_value_number(nts_map_get(by_reference, symbol_value(one))) == 1);
  nts_map_set(by_reference, symbol_value(one), nts_value_of_number(9));
  ok("and storing again replaces rather than adds",
     by_reference->header.length == 2 &&
         nts_value_number(nts_map_get(by_reference, symbol_value(one))) == 9);

  /* The mixed key, which is the one the profile is waiting on. A string and a
   * symbol in one map must not collide and must not be confused. */
  NtsMap *mixed = nts_map_new(0.0 /* NTS_KEY_ERASED */);
  NtsValue as_text =
      nts_value_of_reference((NtsHeader *)text("one"), NTS_TAG_STRING);
  nts_map_set(mixed, symbol_value(one), nts_value_of_number(10));
  nts_map_set(mixed, as_text, nts_value_of_number(20));
  ok("a symbol and a string of the same description are two keys",
     mixed->header.length == 2);
  ok("the symbol keeps its own value",
     nts_value_number(nts_map_get(mixed, symbol_value(one))) == 10);
  ok("and the string keeps its own",
     nts_value_number(nts_map_get(mixed, as_text)) == 20);
  ok("a symbol nothing stored is absent",
     !nts_map_has(mixed, symbol_value(two)));

  /* **Two symbols with the same description are two keys.**
   *
   * Every other case here uses distinct descriptions, so a map that compared
   * descriptions would pass all of them. This one is here because mutating
   * `nts_key_eq` to compare descriptions passed all of them too.
   *
   * And what it catches is narrower than it looks, which is worth writing down
   * rather than leaving for the next person to rediscover. Breaking equality
   * **alone** is still invisible: `nts_hash_key` hashes a symbol by its
   * pointer, so two symbols land in different buckets and their equality is
   * never consulted. What this catches is the *coherent* wrong design --
   * hashing and comparing by description together -- which is the one a person
   * would actually write. An incoherent pair is a map that is already broken
   * for reasons no symbol test should be responsible for finding. */
  NtsSymbol *twin_a = nts_symbol_new(text("twin"));
  NtsSymbol *twin_b = nts_symbol_new(text("twin"));
  NtsMap *twins = nts_map_new(0.0 /* NTS_KEY_ERASED */);
  nts_map_set(twins, symbol_value(twin_a), nts_value_of_number(1));
  nts_map_set(twins, symbol_value(twin_b), nts_value_of_number(2));
  ok("two symbols of one description are two map keys",
     twins->header.length == 2);
  ok("and each keeps its own value",
     nts_value_number(nts_map_get(twins, symbol_value(twin_a))) == 1 &&
         nts_value_number(nts_map_get(twins, symbol_value(twin_b))) == 2);

  /* The same through the homogeneous key kind, which takes a different branch
   * of `nts_key_eq` entirely. */
  NtsMap *twins_by_reference = nts_map_new(3.0 /* NTS_KEY_REFERENCE */);
  nts_map_set(twins_by_reference, symbol_value(twin_a), nts_value_of_number(1));
  nts_map_set(twins_by_reference, symbol_value(twin_b), nts_value_of_number(2));
  ok("and by the reference key kind too",
     twins_by_reference->header.length == 2);
}

/* A reference handed out is a reference the caller owns.
 *
 * The registry holds one and the caller is given another, so releasing what
 * `Symbol.for` returned must not take the registry's. The emitted code releases
 * every managed call result -- `produces_owned` says a call yields an owned
 * reference and makes no exception -- so a helper that hands back a borrowed
 * pointer is a use after free waiting for the allocator to reuse the block.
 *
 * `tooling/memory/cases/interned-symbol` is what found it: seventeen calls, 34
 * releases, no retains. The differential could not have -- freed memory nothing
 * reuses still reads correctly. */
static void a_handed_out_reference_is_owned(void) {
  NtsSymbol *first = nts_symbol_for(text("owned"));
  nts_release((NtsHeader *)first);

  /* **`nts_live_count` and not the object's own fields.**
   *
   * The first version of this check compared pointers and read
   * `first->header.flags` after the release, and it passed with the bug in
   * place: the registry still holds the same *address*, and freed memory that
   * nothing has reused still reads back exactly what it held. An instrument
   * that inspects the object it is asking about cannot answer "was this
   * freed", because the answer is stored in the thing that went away.
   *
   * The live count is outside the block. */
  /* One key string, made once. Making it inside the loop allocates seventeen
   * strings the registry does not take, and the count then grows for a reason
   * that has nothing to do with what is being asked -- which is what the first
   * version of this loop measured. */
  NtsString *key_text = text("owned");
  size_t live = nts_live_count();
  for (int at = 0; at < 17; at++) {
    NtsSymbol *each = nts_symbol_for(key_text);
    nts_release((NtsHeader *)each);
  }
  ok("seventeen acquire-and-release cycles free nothing",
     nts_live_count() == live);
  /* And leak nothing, which the count above cannot see: a reference taken and
   * never given back keeps the object live, so `nts_live_count` reads the same
   * either way. The two checks are opposite directions and neither implies the
   * other -- one retain too few frees the registry's symbol, one too many
   * pins it forever, and only reading the count itself catches the second.
   *
   * Safe to read here precisely because the check above established the object
   * was not freed; on a freed block this word is the dying list's next
   * pointer. */
  ok("and leave the registry holding exactly its own reference",
     first->header.reserved == 1);
  ok("and the registry still answers with a symbol",
     nts_symbol_key_for(nts_symbol_for(key_text)) != 0);

  size_t before_key = nts_live_count();
  NtsString *key = nts_symbol_key_for(first);
  ok("keyFor hands out an owned key", key != 0);
  nts_release((NtsHeader *)key);
  ok("and releasing it leaves the registry's own",
     nts_live_count() == before_key);
}

int main(void) {
  a_fresh_symbol_is_its_own_identity();
  a_registered_symbol_is_one_symbol();
  the_description_is_not_the_identity();
  a_symbol_keyed_map();
  a_handed_out_reference_is_owned();
  printf("%d checks, %d failures\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
