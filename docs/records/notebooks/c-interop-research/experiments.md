# Experiments behind record 0361

Run on this machine on 2026-10-29 and 10-30 with clang 23.1.3, GCC 16.2.1 and
TypeScript 7.0.2. The files are kept here as text, not as sources, so no
tool in the repository compiles them.

## Which header annotations clang keeps: `attrs.h`

Compiled with `clang -x c -fsyntax-only -Wall` and `-Xclang -ast-dump`. Clang
keeps `nonnull`, the nullability qualifiers, `noescape`, the analyzer's
`ownership_returns` and `ownership_takes`, and `counted_by` on a struct
field. It warns that GCC's `access` is unknown and that `malloc(deallocator)`
is ignored, and it rejects `counted_by` on a parameter ("only applies to
non-static data members").

```c
/* Which ownership and direction annotations survive into clang's AST? */
#include <stddef.h>

typedef struct inventory inventory;

void inventory_close(inventory *inv);

/* GCC 11: the function that releases the result */
inventory *inventory_open(const char *path, int *error)
    __attribute__((malloc(inventory_close, 1)));

/* GCC 10: buf is read, n is its size */
long write_buf(int fd, const void *buf, size_t n)
    __attribute__((access(read_only, 2, 3)));

/* GCC and clang: pointer arguments that must not be null */
int find_item(inventory *inv, int id, void *out) __attribute__((nonnull(1, 3)));

/* clang: nullability qualifiers */
const char *_Nullable name_of(inventory *_Nonnull inv);

/* clang: the callee does not keep the pointer */
void each(inventory *inv, void (*visit)(const void *, void *),
          void *ctx __attribute__((noescape)));

/* clang static analyzer: ownership */
void *make_block(size_t n) __attribute__((ownership_returns(malloc)));
void free_block(void *p) __attribute__((ownership_takes(malloc, 1)));

/* clang: a flexible array member and its count */
struct buffer { size_t len; int data[] __attribute__((counted_by(len))); };

/* clang: a pointer parameter and its count */
void fill(size_t n, int *__attribute__((counted_by(n))) p);
```

## What LLVM proves from a library's own code: `lib.c`

Compiled with `clang -O2 -S -emit-llvm`. `inventory_add`'s `it` came out
`readonly captures(none)`; `inventory_find`'s `out` `writeonly
captures(none)` with a result range of 0 to 1; `inventory_remember`'s `it`
with no capture attribute (it may be kept); `inventory_each`'s `visit`
`readonly captures(none)`.

```c
/* Which facts can the C compiler prove from a library's own code? */
typedef struct { int id; double price; char name[32]; } item;

struct inventory { item items[16]; int count; const item *last; };

/* Copies *it into the inventory: reads it, does not keep it. */
int inventory_add(struct inventory *inv, const item *it) {
  if (inv->count == 16) return -1;
  inv->items[inv->count++] = *it;
  return 0;
}

/* Writes *out only when found: never reads it, does not keep it. */
int inventory_find(const struct inventory *inv, int id, item *out) {
  for (int i = 0; i < inv->count; i++)
    if (inv->items[i].id == id) { *out = inv->items[i]; return 1; }
  return 0;
}

/* Keeps it: the pointer outlives the call. */
void inventory_remember(struct inventory *inv, const item *it) { inv->last = it; }

/* Calls back through a function pointer: the compiler cannot see what visit keeps. */
void inventory_each(struct inventory *inv, void (*visit)(const item *, void *), void *ctx) {
  for (int i = 0; i < inv->count; i++) visit(&inv->items[i], ctx);
}
```

## zlib's public pointer parameters: `zlib-pointer-params.tsv`

node's bundled zlib (`third_party/node-source/deps/zlib`): the eleven core
sources compiled with `clang -O2 -flto`, linked with `llvm-link` and
optimized with `opt -passes='default<O2>'`. Of 91 public pointer parameters,
59 (65%) are proved not kept (`captures(none)`, `captures(address)` or
`captures(address_is_null)`) and 37 (41%) read-only or write-only. The TSV
beside this file lists each one.

## TypeScript cannot see C write to a variable: `out-parameter-narrowing.ts`

Checked with `tsc --ignoreConfig --noEmit --strict`. TypeScript reports
`TS2339: Property 'size' does not exist on type 'never'` at line 9 (the
variable form) and nothing for the `Ref` form.

```ts
declare function addrOf<T>(place: T): { readonly __ptr: T };
interface Db { readonly size: number }
declare function sqlite3_open(path: string, out: { readonly __ptr: Db | null }): number;

export function viaVariable(): number {
  let db: Db | null = null;
  sqlite3_open("app.db", addrOf(db));
  if (db === null) return -1;
  return db.size;              // TypeScript still thinks db is null, so here it is `never`
}

declare class Ref<T> { constructor(value: T); value: T }
declare function sqlite3_open_ref(path: string, out: Ref<Db | null>): number;
export function viaRef(): number {
  const db = new Ref<Db | null>(null);
  sqlite3_open_ref("app.db", db);
  if (db.value === null) return -1;
  return db.value.size;
}
```
