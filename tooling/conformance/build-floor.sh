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
#
# **`child_process` joined on 2026-09-27, having never been built by anything.**
# Not a regression and not new coverage of a fixed bug: it compiles, loads and has
# no undefined `nts_*` symbol, and was simply in neither list -- see the
# reconciliation below, which is what now makes that state impossible.
# `cluster`, the other unlisted one, went to `BLOCKED` for the reason recorded
# there.
# **`crypto` joined on 2026-09-28, as a new module that builds.** It links the
# machine's libcrypto (`build.sh` says why it is not node's), loads, and has no
# undefined `nts_*` symbol. Building is all it does yet on this lane: every
# public function cascades from five compiler gaps reported the same day, so
# `compiled-axis.floor` holds it at 0.
FLOOR="assert async_hooks buffer child_process console crypto dgram diagnostics_channel dns events fs http net os path perf_hooks process punycode querystring readline stream string_decoder timers tty url util zlib"

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
#
# `dns` is here, and the reason has moved twice in one day. It was the
# `EOF`/`FILE` collision -- `node:dns` publishes 24 c-ares error constants and two
# are named after a `<stdio.h>` type and a `<stdio.h>` macro. That is **fixed**:
# the addon builds, 385184 bytes, and publishes all 24.
#
# What it publishes now is the 24 constants and the two result-order functions.
# `lookup`, `lookupService` and `promises` are not compiled, so the compiled lane
# reads 0 passed and `--sabotage` reads the same. A hollow lane, named here rather
# than counted as a green zero.
#
# `cascade-reach.mjs dns` names the three, and the build's own NTS1001 lines say
# why. All three are lowering gaps and **two of them are the same gap**:
#
#   lookup         `nextTick`, refused at `internal/tick.ts:57` --
#                  `(...received: A) => callback(...received)`, a generic rest
#                  parameter forwarded to a callback. That is
#                  `blockers/a-generic-rest-forwarded-to-its-callback` exactly.
#   lookupService  `ERR_MISSING_ARGS#constructor`, `constructor(...names)`.
#                  A rest parameter again, without the generic.
#   promises       `promiseLookup` and `promiseLookupService` capture a `Promise`
#                  executor's `reject` inside a nested closure.
#                  blockers/a-recursive-arrow-inside-a-function
#
# An earlier version of this comment blamed the module-scope `WeakMap` in
# `internal/async-hooks.ts` for `lookup`. That was wrong, and the mistake is worth
# recording: `cascade-reach.mjs` listed `trackPromise` (cone 11, and that one *is*
# the WeakMap) and `nextTick` as two separate primary refusals, and I read the
# larger cone as the cause of the smaller. The instrument said "could not attribute
# a shape to this one by line range" for `nextTick` and I supplied a shape from the
# neighbouring row instead of reading the build output, which names it in one line.
#
# A fourth was this module's own and is gone: `dnsException` built its error by
# casting to `Record<string, unknown>` and assigning `errno`, `code`, `syscall`
# and `hostname`. A declared class carries them instead, which took the module
# from 37 primary refusals and 26 cascaded functions to 36 and 23.
#
# None of the three is a `dns` problem. Twelve modules import `internal/tick.ts`:
# dgram, diagnostics_channel, dns, events, fs, http, net, process, readline,
# stream, util and zlib. `dns` is simply the module small enough -- 29 things
# behind 32 sites, against `zlib`'s 352 -- that these are the *only* things
# between it and a working compiled lane, which makes it the cheapest proof in the
# profile that any of the three fixes worked.
# `dns` moved into `FLOOR` on 2026-09-11 and this is empty again.
#
# It was here for one reason and one fix cleared it: `node:dns` publishes `EOF`
# and `FILE` as documented public API, and `<stdio.h>` has already claimed those
# as a macro and a type. `program.c` compiled in both spellings -- it includes
# nothing that defines either -- so only the wrapper failed, which is why the
# defect could sit. `HEADER_MACROS` now suffixes them the way C keywords and
# `<math.h>` names were already suffixed, and it reaches struct members and the
# `offsetof` in a descriptor's reference map too, because all three take the name
# from the same JavaScript identifier.
#
# Putting it here rather than leaving it out is what made the fix announce
# itself: the run printed `dns NOW BUILDS` without either lane going to look.
# **`cluster`, from 2026-09-27.** It compiles and it loads, and it would abort on
# first call: four undefined `nts_*` symbols, none of them pinned, and they are
# two different faults.
#
# `nts_child_process_end_stdin`, `nts_child_process_kill` and
# `nts_child_process_write` are **defined** in
# `runtime/node/child_process/child_process.c` and are not linked into a module
# that imports `child_process`'s TypeScript. That is the `dgram` shape this file
# already records forty lines down -- "a binding whose C exists in `net/net.c` and
# was not being linked into a module that imports `net`'s TypeScript" -- so it is
# the same linking gap a second time, in a module nothing ever built.
#
# `nts_cluster_self_connected` is the other fault and the worse one: **no C
# definition anywhere in the tree.** A binding declared on the TypeScript side
# with nothing behind it.
#
# **That falsifies the invariant `KNOWN_UNRESOLVED` is empty for.** The note there
# says "the native half is complete: 331 declared bindings and none without C" and
# that `nm -D` finds "no undefined `nts_` symbol at all" -- and both were measured
# over the modules this floor built, which was 24 of the 26 on disk. One of the two
# it never built has a binding with no C. The claim was true of its population and
# the population was not the tree.
#
# So this entry is not "cluster does not compile". It is "cluster compiles into
# something that cannot run", which a floor measuring only `bytes$` would have
# called a pass -- and did not, because the undefined-symbol check exists.
#
# **`perf_hooks` left on 2026-09-28**, and the entry's own diagnosis was right to
# the line: the addon declared the structs its *exported functions* cross, and a
# record that only a class method returns was not among them -- with the control
# that says so, "add an exported function returning the same interface and it
# compiles". That is what it was: `emit_with` derived the list from `published`,
# which matches an exported **name**, and `PerformanceEntry#toJSON` is not one
# while `PerformanceEntry` is. The declaration pass now asks `member_crossings`,
# the same function the class emitter decides with. `perf_hooks` builds and its
# symbols resolve; it is in `FLOOR` below.
BLOCKED="cluster"

# **Empty, and it held `fs` and `process` an hour ago.**
#
# All twenty-two modules build and load. What changed is compiler-side and was
# reported as three separate fixes: a class reaching JavaScript, a `FieldGet`
# that read an erased slot back as concrete, and the prototype pass no longer
# discarding every prototype in a program when one binding could not be
# declared. `os` came back the same way after regressing on the heterogeneous
# tuple.
#
# Building is not passing, and the gap is wide: `fs` publishes **zero** exports
# and answers 0 of 352 files, `process` zero and 0 of 90. `os` publishes 17 of
# node's 23 and passes 4 of its 9 applicable files. Only `punycode` is green.
#
# An empty BLOCKED means a module that stops building is loud by default rather
# than expected.

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
KNOWN_UNRESOLVED=""

# **Empty, and it was seventeen names this morning.**
#
# The native half is complete: 331 declared bindings and none without C.
# `nm -D` on every artifact the floor just built finds no undefined `nts_`
# symbol at all, which is why every row above reads "builds and loads" with no
# count beside it.
#
# The last one to go was `nts_async_context_get`, which could not be written
# until the return-position escape landed -- its prototype named a per-program
# struct no shared translation unit could spell. Thirteen modules carried it,
# each loading and waiting to abort on first call.
#
# An empty pin is the strongest form of this check: anything undefined is now
# unpinned by definition and reports loud.
#
# Controlled rather than assumed, against `target/node/process.node` -- a stale
# artifact that still carries eight undefined symbols, which makes it the one
# real subject left. With the empty pin it reports
# `UNPINNED: nts_async_context_get nts_async_context_set ...`; with a pin
# covering those eight it reports `[8 undefined, all pinned]`; and `punycode`
# and `timers` stay clean under both.

# The first version of this list also carried `nts_os_homedir`,
# `nts_os_hostname`, `nts_os_tmpdir`, `nts_os_uptime` and
# `nts_str_to_lower_case`, read out of `target/node/process.node`. **That
# artifact was two days old.** `process` is in BLOCKED and has not built since,
# so `nm -D` on it described a tree that no longer exists -- and all five of
# those symbols are in fact defined, four in `os/os.c` and one in
# `runtime/c/nts_unicode.c`.
#
# Pinning them would have been worse than not checking: the set would have
# tolerated five names on the day `process` started building and one of them
# really was missing. A stale artifact manufactures a finding exactly the way a
# stale baseline manufactures progress, and `target/node` holds whatever the
# last successful build left, which for a BLOCKED module is anything at all.
#
# Read only artifacts newer than the change you are asking about.

compiler=${NTS_COMPILER:-${NTS_BIN:-$PWD/target/release/nts}}
if [ ! -x "$compiler" ]; then
  echo "  no compiler at $compiler; the compiler lane builds it" >&2
  exit 2
fi

failures=0
built=0
# The same resolution `build.sh` uses, in the same order. These were two
# expressions for one directory and they did not agree: this line honoured
# `NTS_CONFORMANCE_OUT` and `build.sh` ignored it, so setting it sent the floor
# looking for addons where none are written.
out_dir=${NTS_ADDON_OUT:-${NTS_CONFORMANCE_OUT:-$PWD/target/node}}
# The undefined `nts_*` symbols an addon still needs, and the ones nobody pinned.
#
# Two functions rather than four inline lines, because **both loops need the same
# standard**: a module leaves `BLOCKED` by the test `FLOOR` holds it to, or the two
# lists disagree about what "builds" means and the run tells somebody to move a
# module into a list it would fail on arrival. `cluster` is exactly that case -- it
# compiles, it loads, and it has four unpinned symbols -- so with only `bytes$` to
# go on the blocked loop would have reported it as newly building.
undefined_nts() {
  nm -D --undefined-only "$1" 2>/dev/null | grep -oE '\bnts_[a-z0-9_]+' | sort -u
}
unpinned_of() {
  comm -23 <(printf '%s\n' "$1" | grep -v '^$' | sort) \
           <(printf '%s\n' $KNOWN_UNRESOLVED | sort)
}

# **The modules whose *shaped* surface is empty, so no test can reach them.**
#
# Building, loading and resolving symbols are three things this file already
# checks, and none of them is "the module has an API". `assert` lost its entire
# surface on 2026-09-19 and nothing noticed for a fortnight: `Assert#constructor`
# became refused, the module-scope `new Assert(...)` was dropped with it, every
# `export const fail = looseAssertions.fail` then read an object that was never
# built, and an addon exporting `{}` loads perfectly. The conformance lane found
# it in the first compiled-axis run in two weeks.
#
# **Shaped, not raw, and the difference is not small.** `Object.keys(addon)` is the
# addon's own table; `shape.mjs` is what node's tests reach, and the two disagree in
# both directions:
#
#     fs       raw   4  ->  shaped 104     the shim assembles the surface
#     zlib     raw   2  ->  shaped  22
#     console  raw   1  ->  shaped   0     `formatTime`; `log` and `Console` gone
#     cluster  raw   5  ->  shaped   0     constants and booleans, no API
#
# So a raw count would have passed `console` on a residue while its whole API was
# missing. `loads.sh` reports the raw number, which is the right one for a *load*
# check and the wrong one for this.
#
# Checked in both directions like the lists above: a module **joining** this list
# fails the day it happens, and one that starts publishing says so and does not fail,
# because the right response is to remove the name rather than to go red until
# somebody does.
#
# `cluster` is absent because it is in `BLOCKED` and never reaches this check.
#
# `crypto` joined 2026-09-28: raw 8 (`getHashes`, `getCiphers`, `getCurves`,
# `KeyObject`, `constants` and three small functions), shaped 0, because its shape
# publishes nothing until `createHash` exists and the compiled lane refuses it. The
# refusals are compiler gaps reported with reductions (an overloaded function
# lowered at its first overload's return type, `instanceof SharedArrayBuffer`, a
# call through a function value inside `try`), not the port's.
#
# `perf_hooks` joined 2026-09-28, and it joined the same hour its addon first
# compiled -- so this is a fact that became *measurable*, not one that changed.
# Raw 3 (`PerformanceEntry`, `PerformanceMeasure`, `constants`), shaped **0**,
# and its shim says exactly why in its own guard: `if (exports.performance ===
# undefined || exports.PerformanceEntry === undefined) return {}`. The compiled
# module publishes `PerformanceEntry` and not `performance`, the singleton every
# test reaches the module through. So the remaining step is publishing that
# instance, which is the port's (node lane), not the napi codegen gap that kept
# the addon from compiling at all.
PUBLISHES_NOTHING="assert child_process console crypto events perf_hooks timers"

# What `shape.mjs` publishes for an addon: the names a test can reach.
#
# **Written rather than logged**, because `console.log` of a *number* goes through
# `util.inspect` and this repository's interactive shell exports `FORCE_COLOR=3` -- so
# it printed `\033[33m0\033[39m`, the numeric test on it failed silently, and every
# known-empty module was reported as newly publishing -- a guard inverted into good
# news, which is the worst direction available to one.
#
# **The rule, for the next helper added here:** `console.log` is an *inspector*, not a
# printer. Anything handed to it that is not already a string may come back decorated
# -- a number coloured, a string quoted inside a structure, a `Map` as `Map(2) {...}`.
# For a value a script will parse, `process.stdout.write(String(x))`. `env -u
# FORCE_COLOR` at the call site is the wrong fix: it leaves the helper wrong and
# working by luck.
shaped_names() {
  node --input-type=module -e "
    import { createRequire } from 'node:module';
    const require = createRequire(process.cwd() + '/');
    const raw = require(process.argv[1]);
    const { shape } = await import(process.argv[2]);
    process.stdout.write(String(Object.keys(shape(raw)).length));
  " "$1" "$2" 2>/dev/null
}

# **Every module on disk is in one of the two lists, or this is not a floor.**
#
# The lists are written out above rather than derived, deliberately -- a derived
# list cannot say *why* a module is expected to fail -- and that leaves a third
# state neither list can express: a module in **neither**. The loops below walk
# the lists, so such a module is never handed to clang by anything, and nothing
# says so.
#
# `child_process` and `cluster` were in that state from 2026-09-13, when
# `cluster` arrived as "the 26th module", until 2026-09-27: `profile` emitted
# their C and counted it and `snapshot-cache` diffed it, and neither ever
# compiled. The comment on `FLOOR` says a stale floor "does not just miss a
# regression, it manufactures progress"; a floor that does not cover the
# directory does the same thing one level up, and reads as 24 of 24 while the
# tree holds 26.
#
# Newlines folded to spaces first, because `FLOOR` is written across three lines
# and a name at the end of one is followed by a newline rather than a space --
# which a ` $module ` match would miss, and the check would then pass by
# accident for exactly the modules at a line break.
listed=" $(printf '%s %s' "$FLOOR" "$BLOCKED" | tr '\n' ' ') "
unlisted=""
seen=0
for config in runtime/node/*/tsconfig.json; do
  # An unexpanded glob is a literal `*`, which would otherwise be reported as an
  # unlisted module -- loud, and about the wrong thing. Counted instead, so that
  # "no modules found" is its own sentence: a reconciliation that walked nothing
  # would *pass*, which is the vacuous-guard shape this file records elsewhere
  # ("the `listing` guard that would have caught the collision was vacuous").
  [ -f "$config" ] || continue
  seen=$((seen + 1))
  module=$(basename "$(dirname "$config")")
  case "$listed" in
    *" $module "*) ;;
    *) unlisted="$unlisted $module" ;;
  esac
done
if [ "$seen" -eq 0 ]; then
  echo "  INSTRUMENT FAILURE: no runtime/node/*/tsconfig.json found -- run this from the repository"
  exit 2
fi
if [ -n "$unlisted" ]; then
  echo "  INSTRUMENT FAILURE: in neither FLOOR nor BLOCKED:$unlisted"
  echo "  Add each to FLOOR if it builds and loads, or to BLOCKED with the reason it does not."
  exit 2
fi

# **Each module is judged in its own process, several at once.** The modules
# share nothing: each emits into its own `$out_dir/<module>.build`, links its
# own `<module>.node`, and the judging below reads only those. Serially this was
# the gate's longest step (573 s on 2026-10-02, 3,229 s once the compiler got
# slower), all of it one lowering and one link after another on an idle box.
# The largest modules start first, because the step ends when the last one
# does; the lines are printed in FLOOR order afterwards, as they always were.
judge() {
  module=$1
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
      unresolved=$(undefined_nts "$out_dir/$module.node")
      novel=$(unpinned_of "$unresolved")
      count=$(printf '%s\n' "$unresolved" | grep -c . )
      if [ -n "$novel" ]; then
        echo "loads with UNPINNED undefined symbol(s) -- would abort on first call"
        printf '%s\n' "$novel" | sed 's/^/                         /'
        judged=fail
      else
        shape_file="runtime/node/$module/shape.mjs"
        if [ ! -f "$shape_file" ]; then
          echo "INSTRUMENT FAILURE: no $shape_file to read its surface through"
          judged=fail
          return
        fi
        names=$(shaped_names "$out_dir/$module.node" "$PWD/$shape_file")
        pinned=""
        [ "${count:-0}" -gt 0 ] && pinned="  [$count undefined, all pinned]"
        case " $PUBLISHES_NOTHING " in
          *" $module "*) known=yes ;;
          *) known=no ;;
        esac
        if [ "${names:-0}" -eq 0 ] 2>/dev/null; then
          if [ "$known" = yes ]; then
            echo "builds and loads, publishes nothing [known]$pinned"
            judged=built
          else
            echo "PUBLISHES NOTHING -- its shaped surface is empty, so no test reaches it"
            judged=fail
          fi
        elif [ "$known" = yes ]; then
          printf 'builds and loads, %s name(s) -- NOW PUBLISHES, remove it from PUBLISHES_NOTHING%s\n' "$names" "$pinned"
          judged=built
        else
          echo "builds and loads, $names name(s)$pinned"
          judged=built
        fi
      fi
    else
      echo "BUILDS BUT DOES NOT LOAD"
      node -e 'require(process.argv[1])' "$out_dir/$module.node" 2>&1 |
        head -1 | sed 's/^/                         /'
      judged=fail
    fi
    return
  fi
  # **"Could not run" is not "does not build".** A missing `target/tsgo` -- which
  # is every run from a worktree -- makes *every* module print `REGRESSED`, and
  # the reader's first thought is that the compiler broke twenty-six modules at
  # once. The reason line below has always said so underneath, and the verdict
  # word is the half that gets quoted. Same shape as the clang-probe contention
  # this file's own header worries about: an environment failure reported as a
  # finding about the subject.
  #
  # Still counted as a failure, because a floor that measured nothing is not a
  # pass. Only the label changes.
  if printf '%s' "$out" | grep -qE 'could not start|transport failed'; then
    echo "NOT MEASURED -- the frontend could not run"
  else
    echo "REGRESSED -- was building on 2026-09-08 and no longer does"
  fi
  # **The verdict names its reason, or says it has none.**
  #
  # This grepped `error:` alone, which is clang's spelling. A *typecheck* refusal
  # is `TS6133 ... is declared but its value is never read` followed by
  # `Error: the program does not typecheck` -- no lowercase `error:` anywhere --
  # so a module that stopped typechecking printed `REGRESSED` with nothing under
  # it. On 2026-09-10 that rendered one unused function in `net` as three modules
  # regressing for no stated reason, and the reader's first thought is that the
  # compiler broke them.
  #
  # `net` is in the module graph of `http` and `process`, which is why one edit
  # failed three: the blast radius of a briefly untypecheckable module is its
  # dependents, not itself.
  reason=$(printf '%s\n' "$out" | grep -E 'error:|Error:|TS[0-9]{4}|NTS[0-9]{4}' | head -3)
  if [ -n "$reason" ]; then
    printf '%s\n' "$reason" | sed 's/^/                         /'
  else
    # A bare REGRESSED is the one outcome that cannot be acted on, so the absence
    # of a reason is stated as a fact about the output rather than left as blank.
    echo "                         (no error, Error:, TS or NTS line in the build output)"
  fi
  judged=fail
}

jobs=${NTS_ADDON_JOBS:-${NTS_GATE_JOBS:-4}}
verdicts=$(mktemp -d)
# The sibling objects every module links, compiled once for this run (see
# build.sh); fresh per run, so nothing carries over from another tree or day.
NTS_ADDON_SIBLING_CACHE=$(mktemp -d)
export NTS_ADDON_SIBLING_CACHE
by_size=$(for module in $FLOOR; do
  printf '%s %s\n' "$(find "runtime/node/$module" -name '*.ts' -type f -print0 2>/dev/null |
    xargs -0 cat 2>/dev/null | wc -c)" "$module"
done | sort -rn | awk '{ print $2 }')
running=0
for module in $by_size; do
  (
    judged=none
    printf '  %-22s ' "$module"
    judge "$module"
    printf '%s\n' "$judged" > "$verdicts/$module.verdict"
  ) > "$verdicts/$module.out" 2>&1 &
  running=$((running + 1))
  if [ "$running" -ge "$jobs" ]; then
    wait -n
    running=$((running - 1))
  fi
done
wait
for module in $FLOOR; do
  cat "$verdicts/$module.out"
  case $(cat "$verdicts/$module.verdict" 2>/dev/null) in
    built) built=$((built + 1)) ;;
    fail) failures=$((failures + 1)) ;;
    *)
      # A module whose judging printed no verdict was not judged: count it as
      # a failure rather than let the floor shrink by one unnoticed.
      echo "  ${module}: NOT JUDGED -- the build-and-load check ended without a verdict"
      failures=$((failures + 1)) ;;
  esac
done
rm -rf "$verdicts"

joined=0
# **A blocked module's build is a probe, and a probe leaves no product.**
#
# This loop compiles each blocked module to ask whether it builds yet, and until
# this it wrote the artifact into the shared addon directory like any other build.
# `loads.sh` then ran next, found `cluster.node`, loaded it eagerly and failed on
# `undefined symbol: nts_child_process_kill` -- so adding a module to `BLOCKED`
# turned the `addons` step red for every lane, which is the opposite of what a
# list of known failures is for. It cost two lanes a gate run each and read as
# somebody's change.
#
# So the probe builds into a directory of its own, and any artifact a previous
# run of this script left behind is removed with a line saying so: a module in
# `BLOCKED` has no product by definition, and one lying in the addon directory is
# an artifact nothing in the tree claims and everything downstream trusts.
probe_out=$(mktemp -d)
trap 'rm -rf "$probe_out" "$NTS_ADDON_SIBLING_CACHE"' EXIT
for module in $BLOCKED; do
  if [ -f "$out_dir/$module.node" ]; then
    rm -f "$out_dir/$module.node"
    printf '  %-22s an artifact of a blocked module removed from the addon directory\n' "$module"
  fi
  out=$(NTS_ADDON_OUT="$probe_out" NTS_COMPILER="$compiler" NTS_BIN="$compiler" \
    timeout 1800 bash tooling/conformance/build.sh "$module" 2>&1)
  if printf '%s' "$out" | grep -q 'bytes$'; then
    # **Compiling is not the standard.** `FLOOR` requires compile, load, and no
    # unpinned undefined symbol; a blocked module that only compiles is not ready
    # to move, and saying it is sends the next reader to break the run.
    if ! node -e 'require(process.argv[1])' "$probe_out/$module.node" > /dev/null 2>&1; then
      printf '  %-22s compiles but does not load -- still blocked\n' "$module"
    elif [ -n "$(unpinned_of "$(undefined_nts "$probe_out/$module.node")")" ]; then
      printf '  %-22s compiles and loads, unpinned symbols remain -- still blocked\n' "$module"
    else
      printf '  %-22s NOW BUILDS -- move it into FLOOR and say what changed\n' "$module"
      joined=$((joined + 1))
    fi
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
