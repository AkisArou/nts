# native-rusage

`getrusage` filling a struct built out of C11 anonymous members.

`struct rusage` is fourteen anonymous unions in a row. Each holds two names for
the same eight bytes -- glibc's API name and a kernel-layout alias -- and
**neither the union nor its members has a declarator**:

    struct rusage {
      struct timeval ru_utime;
      struct timeval ru_stime;
      __extension__ union { long int ru_maxrss; __syscall_slong_t __ru_maxrss_word; };
      ...

C reaches through one as though its fields belonged to the enclosing struct.
That transparency is not a convenience to reproduce; it is a property of the
language that decides how this is described. `theirs.ru_maxrss`,
`offsetof(struct rusage, ru_maxrss)` and `_Generic(&p->ru_maxrss, long *: 1)`
are all legal C for a member of an anonymous union, so the binding describes the
struct **flat** and every check already generated works unchanged:

    ru_maxrss: c_long; // the same bytes as __ru_maxrss_word

There is no marker on the TypeScript side and nothing to spell. A member that
has no name in C is not a shape a consumer should have to know about, which is
why it is absent from the surface rather than represented in it.

A union contributes only its **first** member. A member carries no offset of its
own -- offsets come from the order fields are written -- so two members cannot
share one, and the alternative would be a surface naming the same bytes twice.
The names dropped are stated on the member that stands in for them rather than
lost. This is pessimistic about what can be *named* and never wrong about what
is *there*: where the first member does not reproduce the union's size, the
generator's recomputed layout disagrees with clang's and the record is refused.

## What checks it

`native/caller.c` calls `getrusage` itself, through the real
`<sys/resource.h>`, and **lends its own struct** to the compiled TypeScript. Both
readers see the same bytes, so an equal answer is about the offset and only
about the offset -- nothing is re-measured between two calls.

Four arms, each able to fail on its own:

| arm | member | what it catches |
|---|---|---|
| `utimeSecOf` | `ru_utime.tv_sec`, offset 0 | passes even with every anonymous union mishandled, so a run where *this* fails says the binding is wrong about something else |
| `maxrssOf` | `ru_maxrss`, offset 32 | the first member behind an anonymous union |
| `nivcswOf` | `ru_nivcsw`, offset 136 | the **last** of the fourteen: one union described at the wrong size leaves every earlier offset right and this one wrong |
| `ownMaxrss` | storage this program owns | the other direction -- libc filling a `local<Rusage>()`. `ru_maxrss` is a high-water mark, so `caller.c` brackets the call between two of its own and the answer must lie between them |

`native_witness.c` carries 40 `_Static_assert`s, including the ones that only
exist because C is transparent here:

    _Static_assert(offsetof(struct rusage, ru_maxrss) == 32u, "rusage.ru_maxrss offset");
    _Static_assert(_Generic(&(((struct rusage *)0)->ru_maxrss), long *: 1, default: 0), ...);

Three mutations of the generated binding, each caught:

| mutation | size | offsets | what fires |
|---|---|---|---|
| a member deleted | changes | change | `sizeof(struct rusage)` |
| two members swapped | same | change | `offsetof` |
| `c_long` → `c_ulong` | **same** | **same** | `_Generic` alone |

The third is the one worth having. Size 144 and offset 32 are both still
correct, and the only failing assertion is the one about the field's type.

## The constant this cannot carry, and the name it must not use

`RUSAGE_SELF` is an *enumeration constant*, not a macro, so `nts bind-c --const`
refuses it: emitting a global of that name would collide with the header's own
declaration. `src/main.ts` spells the value itself, which makes it a claim, and
`caller.c` asserts it against the real header rather than trusting the line.

The constant is deliberately **not** named `RUSAGE_SELF`. A module-level `const`
is emitted as a file-scope variable in the same translation unit as the header
the binding names, and the emitter's `#undef` of every generated identifier
settles a colliding *macro* and does nothing for an enumerator. The build fails
loudly -- clang names the line and the previous definition -- but it fails in C
rather than in a diagnostic, which is worth knowing before it happens.

## Building

    sh examples/interop/native-rusage/build.sh

The binding is generated, not hand-written:

    nts bind-c --module c:sys/resource --header sys/resource.h \
      --record rusage --record timeval --fn getrusage \
      --no-escape getrusage:usage \
      --alias rusage=Rusage --alias timeval=Timeval \
      --out examples/interop/native-rusage/types/rusage.d.ts
