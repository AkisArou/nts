#!/usr/bin/env bash
# The modules that compile today, and a refusal when one stops.
#
#   tooling/conformance/build-floor.sh
#   NTS_COMPILER=<a pinned copy> tooling/conformance/build-floor.sh
#
# Emitting C and compiling it are different claims, and only one of them was
# being checked. The gate's `profile` step emits C for all twenty-two modules
# and never runs a compiler over any of it, so a change that breaks the
# compilation of every node module passes the gate green. That is not
# hypothetical: on 2026-09-08 a prototype in `internal/nts_node.h` stopped
# matching what the backend emitted, `buffer` and `string_decoder` went from
# building to not building, and the gate carrying that change was green.
#
# It was caught by rebuilding everything for an unrelated measurement. That is
# luck, and this is the check that replaces it.
#
# A floor rather than a target. It does not care how many modules build; it
# cares that the ones which did still do. Raise `FLOOR` when a module joins --
# deliberately, in a commit that says why -- and never lower it to make a run
# pass, which is the one thing that would make it worthless.
set -u
cd "$(dirname "$0")/../.."

# Measured 2026-09-08 on the compiler lane's gate binary, from a pinned tree.
# Updated 2026-09-08: eleven modules moved up. They were **already building on
# the gated commit** -- the axis has read `builds 20 of 22` for a while -- and
# this list had not been touched since the night nine did. So the run that
# printed "11 newly building" was reporting the age of this line, not a change
# in the compiler, and it printed that against a binary carrying `AnyView`
# where it was very easy to read as `AnyView`'s doing. It is not: builds and
# loads are 20 of 22 with and without it, which is what the refusal counts
# predicted. A stale floor does not just miss a regression, it manufactures
# progress, and the second failure is louder than the first.
FLOOR="assert async_hooks buffer console dgram diagnostics_channel events http net os path punycode querystring readline stream string_decoder timers url util zlib"

# And the ones that do not, which is the half that rots.
#
# A list of "known to fail" that nobody updates quietly becomes a list nobody
# reads, and then a module that *started* building is invisible -- the same
# failure as a `-Werror` suppression outliving its cause. So this is checked in
# both directions: a name in `FLOOR` that stops building is a regression, and a
# name in `BLOCKED` that starts building is news that has to be acted on rather
# than a pleasant surprise nobody notices.
#
# Twelve of these fail on `blockers/duplicate-type-name` and `timers` fails on
# an undeclared identifier. When that fixture is fixed most of this list moves,
# and the run will say so by name.
# The two that do not build. Both are the largest modules in the profile and
# both have the most declared-but-unimplemented bindings, so neither is one
# compiler fix away.
BLOCKED="fs process"

# Bindings that are declared, reached, and have no C anywhere. Measured with
# `nm -D` on the built artifacts 2026-09-09. Every one of these would abort the
# process on first call; they are pinned so the set cannot widen unnoticed, not
# because any of them is acceptable.
#
# `nts_async_context_get` is the one that cannot simply be written: it returns
# an object, so its prototype names a per-program struct that no shared
# translation unit can spell. See
# `blockers/binding-returns-program-type`. The other two in that trio take
# rather than return and are ordinary missing C.
KNOWN_UNRESOLVED="nts_async_context_get nts_async_context_set nts_on_collected
nts_net_get_tos nts_net_read_start nts_net_ref nts_net_server_ref
nts_net_set_keepalive nts_net_set_no_delay nts_net_set_tos
nts_os_homedir nts_os_hostname nts_os_tmpdir nts_os_uptime
nts_str_to_lower_case nts_udp_recv_stop nts_udp_ref"

compiler=${NTS_COMPILER:-${NTS_BIN:-$PWD/target/release/nts}}
if [ ! -x "$compiler" ]; then
  echo "  no compiler at $compiler; the compiler lane builds it" >&2
  exit 2
fi

failures=0
built=0
out_dir=${NTS_CONFORMANCE_OUT:-$PWD/target/node}
for module in $FLOOR; do
  printf '  %-22s ' "$module"
  out=$(NTS_COMPILER="$compiler" NTS_BIN="$compiler" \
    timeout 1800 bash tooling/conformance/build.sh "$module" 2>&1)
  if printf '%s' "$out" | grep -q 'bytes$'; then
    # Compiling is not loading, and the difference is not academic. `dgram`
    # compiled, linked, and failed at `require()` with
    # `undefined symbol: nts_net_default_auto_select_family` -- a binding whose C
    # exists in `net/net.c` and was not being linked into a module that imports
    # `net`'s TypeScript. A shared object resolves lazily, so nothing before the
    # load says a word, and this floor called it a pass for a day.
    if node -e 'require(process.argv[1])' "$out_dir/$module.node" > /dev/null 2>&1; then
      # Loading is a weaker statement than it reads, and this line used to be
      # the whole of it.
      #
      # A shared object binds lazily: an undefined function symbol is not an
      # error until something calls it, so an addon whose bindings have no C
      # anywhere still initialises and still prints "builds and loads". On
      # 2026-09-09, `nm -D` said **14 of the 20** were in that state --
      # `nts_async_context_get`, `nts_async_context_set` and `nts_on_collected`
      # in every one of them, plus seven `nts_net_*` in `net`, `http` and
      # `dgram`, and five more in `process`. Each would abort on first call.
      #
      # `punycode` is the only module with **zero** undefined symbols, and it is
      # the only module that passes its tests as a compiled addon. That is not a
      # coincidence worth much on its own, and it is the kind of corroboration
      # that makes a new check believable on the day it is added.
      #
      # Controlled by removing one symbol from the pinned set: `timers`, `net`
      # and `process` all reported `UNPINNED: nts_on_collected`, and `punycode`
      # stayed clean.
      #
      # Reported rather than failed, and pinned rather than counted, for the
      # same reason the ABSENT lists in the surface tests are: a number that
      # nobody wrote down can grow one at a time and never look like a change.
      # KNOWN_UNRESOLVED is the set as measured; anything outside it is loud.
      unresolved=$(nm -D --undefined-only "$out_dir/$module.node" 2>/dev/null |
        grep -oE '\bnts_[a-z0-9_]+' | sort -u)
      novel=$(comm -23 <(printf '%s\n' "$unresolved" | grep -v '^$' | sort) \
                       <(printf '%s\n' $KNOWN_UNRESOLVED | sort))
      count=$(printf '%s\n' "$unresolved" | grep -c . )
      if [ -n "$novel" ]; then
        echo "loads with UNPINNED undefined symbol(s) -- would abort on first call"
        printf '%s\n' "$novel" | sed 's/^/                         /'
        failures=$((failures + 1))
      elif [ "${count:-0}" -gt 0 ]; then
        echo "builds and loads  [$count undefined, all pinned]"
        built=$((built + 1))
      else
        echo "builds and loads"
        built=$((built + 1))
      fi
    else
      echo "BUILDS BUT DOES NOT LOAD"
      node -e 'require(process.argv[1])' "$out_dir/$module.node" 2>&1 |
        head -1 | sed 's/^/                         /'
      failures=$((failures + 1))
    fi
    continue
  fi
  echo "REGRESSED -- was building on 2026-09-08 and no longer does"
  printf '%s\n' "$out" | grep -E 'error:' | head -3 | sed 's/^/                         /'
  failures=$((failures + 1))
done

joined=0
for module in $BLOCKED; do
  out=$(NTS_COMPILER="$compiler" NTS_BIN="$compiler" \
    timeout 1800 bash tooling/conformance/build.sh "$module" 2>&1)
  if printf '%s' "$out" | grep -q 'bytes$'; then
    printf '  %-22s NOW BUILDS -- move it into FLOOR and say what changed\n' "$module"
    joined=$((joined + 1))
  fi
done

echo
if [ "$built" -eq 0 ] && [ "$failures" -eq 0 ]; then
  # An empty floor is not a clean run. The list is written above rather than
  # derived, so a typo in it reads as success unless this says otherwise.
  echo "  INSTRUMENT FAILURE: the floor list is empty."
  exit 2
fi
total=$(printf '%s\n' $FLOOR | wc -l | tr -d ' ')
echo "  $built of $total still build, $failures regressed, $joined newly building"
# A newly-building module is not a failure and must not be silent either. It is
# reported and does not fail the run, because the right response is to move the
# name and record why, not to make the run red until somebody does.
[ "$failures" -eq 0 ]
