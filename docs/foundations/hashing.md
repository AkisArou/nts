# Hashing and hash tables

**Status:** designed, not built. The seed is the user's decision; the rest is
the coordinator's design, to be settled by the rows below.

`Map`, `Set` and objects used as dictionaries hash their keys. Two things
matter: speed on the short keys real programs use (property names, words,
identifiers), and **hash flooding**. That attack is input whose keys all
collide, making every insert and lookup scan the whole table, so a `Map` or a
`JSON.parse` turns quadratic. Bun once had a 2.5 s `JSON.parse` from it.

## Where nts stands

| | today | problem |
|---|---|---|
| strings, native | FNV-1a over UTF-16 code units, one unit at a time, plus a 64-bit mixer; cached in the string; literal hashes fixed at compile time | **unseeded**, so colliding keys can be precomputed; one dependent multiply per unit makes long keys slow |
| numbers, references | the same mixer, unseeded | the same |
| BigInt keys | `mix(low) ^ mix(high) ^ tag` (`runtime/c/nts_runtime.c`, the `NTS_TAG_BIGINT` case) | **swapping the halves gives the same hash, and equal halves cancel**: structural collisions, whatever the seed |
| JVM tables | `String.hashCode` times a constant, then a shift (`runtime/jvm/src/nts/rt/NtsTable.java`, `hashString`) | Java's string hash collides trivially (`"Aa"` and `"BB"`), and a mixer cannot separate keys that already collide: **the JVM table can be flooded** |
| Wasm | 32-bit FNV-1a in `compiler/codegen/wasm/src/collections.rs` | unseeded, and a different definition from native |
| the table | insertion-ordered entries plus an open-addressing index holding each entry's hash; growth rebuilds from the cached hashes | rebuilding from cached hashes cannot separate full collisions |

## The design

1. **One exact definition, generated for every backend that owns its
   hashing.** A string's hash is defined over a type tag followed by its UTF-16
   code units, in order, including embedded zeros and lone surrogates, with
   no normalization. A one-byte (Latin-1) string widens its units in
   registers, never into a temporary buffer, so equal strings of either width
   hash alike. The generator stays where it is
   (`compiler/codegen/common/src/string_hash.rs`), with known-answer vectors
   checked on every backend.
2. **A secret key per process,** set before anything is hashed, from the
   environment's secure randomness. If none is available, the program says so
   rather than running unkeyed. The key never changes while hashes made under
   it are alive.
3. **The function:** both candidates are measured on our rows, then one is
   chosen.
   - **rapidhash v3 with randomized secret constants:** the fastest published
     short-key hash, and what V8 (node) and JavaScriptCore (Bun) use now.
     Randomizing only its seed is not enough: the secrets must be random too
     (node's July 2025 security release).
   - **SipHash-1-3:** the better-established keyed hash (Rust, CPython),
     slower on short uncached keys.

   The table fallback below bounds the worst case whichever is chosen. That
   turns the choice into mainly a speed question, so the faster one wins
   unless the rows show no difference.
4. **The table defends itself.** It counts probes. Past a budget set from
   normal probe-length measurements, that table's index switches to a
   balanced tree over the actual keys. Iteration order is unaffected, since
   entries stay in their ordered arrays. Lookups are then O(log n) however the
   keys collide. Java's HashMap does the same per bucket; nts does it per
   table. The tree orders real keys (code units, numbers, identity tokens),
   never hashes.
5. **Literal hashes are computed lazily, into writable metadata:** the first
   use of a literal as a key hashes it and caches the result. A compile-time
   digest keyed at run time is not safe: every collision of the unkeyed
   digest survives any key. With future workers, a literal shared between
   threads gets per-thread metadata or its hash at startup, never an
   unsynchronized lazy write.
6. **Numbers, references and BigInts are keyed too,** each in its own type
   domain. A BigInt hashes its full value in order, not its halves XORed.
   Number canonicalization stays: `-0` equals `+0`, and every NaN is one key.

## Build order

| step | work | rows and tests |
|---|---|---|
| 1 | the definition and generator, with known-answer vectors on C, LLVM and Wasm; both functions behind one switch for the A/B | equal strings of both widths hash alike; lone surrogates; embedded zeros |
| 2 | the process key; lazy literal hashes; BigInt hashed in order | startup cost; first use of a literal |
| 3 | the probe budget and tree fallback | an adversarial-keys row (all colliding) must stay O(n log n); `map-and-set`, `str-map-keys` and the word counts must not regress |
| 4 | the A/B, then the choice | cold, cached and fresh-equal keys; both widths; failed lookups; deletions; the JSON rows; binary size |
| 5 | JVM: the same table protection over `String` keys | waits for the JVM phase; recorded as a known weakness until then |

## Evidence

The design follows an outside research review, with sources, SMHasher3
results and published speed figures. Its claims about nts's code were checked
against the code.

## Decisions

- String hashing takes a random seed per process, against hash flooding.
- Map and Set tables compact deleted entries, with a list of live cursors so
  that iteration stays correct.

Both are in the [log](../records/notebooks/decisions-log.md#objects-10-22).
