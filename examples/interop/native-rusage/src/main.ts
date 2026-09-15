import { getrusage, type Rusage } from "c:sys/resource";
import { local } from "c:memory";
import type { Ptr, c_int, c_long } from "c:types";

// `RUSAGE_SELF` is an enumeration constant, not a macro, so `nts bind-c`
// refuses to carry it -- a `--const` would emit a global with a name the header
// already declares. Written here instead, which makes it a claim: `caller.c`
// asserts it against the real <sys/resource.h> rather than trusting this line.
//
// **Not** named `RUSAGE_SELF`. A module-level `const` is emitted as a file-scope
// variable assigned at startup, in the same translation unit as the header this
// binding names, and the header declares that identifier as an enumerator. The
// emitter `#undef`s every name it generates, which settles a colliding *macro*
// and does nothing for an enumerator. The build fails loudly -- clang names the
// line and the previous definition -- but it fails in C, not in a diagnostic.
const SELF_USAGE = 0 as c_int;

// The precise arm. C fills a `struct rusage` and lends it here, so both readers
// see *the same bytes* and the comparison cannot drift between two calls.
//
// `ru_maxrss` is the first member behind an anonymous union. C reaches it as a
// member of the enclosing struct and so does this; the offset is 32 on LP64,
// which `native_witness.c` asserts against the real header.
export function maxrssOf(usage: Ptr<Rusage>): bigint {
  return usage.ru_maxrss;
}

// The last member of fourteen anonymous unions in a row. A binding that gets
// the size of one of them wrong -- 16 bytes instead of 8, say, or a union
// skipped -- has every earlier offset right and this one wrong, which is the
// failure `maxrssOf` alone cannot see.
export function nivcswOf(usage: Ptr<Rusage>): bigint {
  return usage.ru_nivcsw;
}

// Before the anonymous run, through a nested record. This arm passes even if
// every anonymous union is mishandled, so a run where it fails too says the
// binding is wrong about something else entirely.
export function utimeSecOf(usage: Ptr<Rusage>): bigint {
  return usage.ru_utime.tv_sec;
}

// `local<Rusage>()` is already a `Ptr<Rusage>` -- storage and its address are
// one thing here, so there is no `addrOf` to take.
//
// The other direction: storage this program owns, filled by libc. `ru_maxrss`
// is a high-water mark and never decreases, so `caller.c` brackets this call
// between two of its own and the answer must lie between them.
export function ownMaxrss(): bigint {
  const usage = local<Rusage>();
  if (getrusage(SELF_USAGE, usage) !== 0) return -1n;
  return usage.ru_maxrss;
}

// The constant above, handed back so C can check it against the real header.
export function selfUsage(): number {
  return SELF_USAGE;
}
