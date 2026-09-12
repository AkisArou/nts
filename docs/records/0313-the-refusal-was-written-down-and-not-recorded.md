# The refusal was written down and not recorded

`process.node` could not be loaded:

```
node: symbol lookup error: .../process.node: undefined symbol: module__init
```

`addon.c` declares `void module__init(void);` and calls it from
`NAPI_MODULE_INIT`. `program.c` defined it in no translation unit.

## The compiler said so

It was not silently dropped. `emit-c` printed, in the same run:

```
NTS2009 `module#init` cannot be emitted because it calls `EventEmitter#on`,
        which this backend refused above
```

`drop_orphaned_bodies` computes that cascade to a fixed point — a body calling a
function this backend refused cannot be emitted either — and removes the body.
**It did not record what it removed.**

`Emitted::refused` is the list the napi wrapper consults before writing a call,
and its doc comment says exactly why it exists: *"a refused body leaves the
`Func` in place, so this pass saw a public export with a signature that crosses
and wrote a wrapper naming a symbol that does not exist."* That list held only
the **direct** declines. A body dropped as a cascade was invisible to the one
consumer the list was built for.

And `emit_module_init_prototype` asked a second question that looks like the
first: does `program.funcs` contain a `module#init`. That answers *the program
has top-level code*, which is a fact about the source. What the addon needs to
know is *the C file defines something to call*.

## Why it survived a whole day of green

The artefact **links**. A shared object resolves undefined symbols at load, so
`clang` is content, `emit-c` exits 0 and prints `wrote program.c`, and the
failure arrives at `require` time in a different process run by a different
tool. Every step of the pipeline reported success on an artefact that could not
be loaded at the moment it was written.

Then it cost a number. `process`'s compiled row read **92 failed**, which is one
load failure counted ninety-two times — and the compiled axis read 74 with
`process` at 0 where the same tree a day earlier gave it 1.

## What made it invisible to me specifically

`addons` was red in **every gate run I made that day**, about a dozen, and I read
it as the Node lane's recorded `process` decision each time. It was filed, I had
the commit hash, and I stopped looking.

**A step that is expected to fail is a step nobody reads.** The Node lane found
it by bracketing two pinned compilers against the same source, which is work
nobody does on a step they believe is understood.

That has a twin on their side from the same night: two files filed under one
cause on a sentence they had written turned out to be two unrelated bugs. A row
with a story attached stops being read, and it does not matter whether the story
is "expected to fail" or "already explained".

## The fix, and the half that is not a fix

Two lines: `drop_orphaned_bodies` pushes every name it drops into `refused`, and
`emit_module_init_prototype` consults `refused`. `process` builds and loads;
`addons` reports 24 of 24 with 0 regressed, and exits 0 for the first time that
day.

What is *not* fixed is that `emit-c` exits 0 on a program it has declined a
called function from. The artefact was unloadable at the moment it was written
and everything after was an elaborate way of discovering that later. The Node
lane's `node -e 'require(path)'` after linking catches this class exactly and
costs milliseconds; it is not in `build.sh` yet because making it fail would
red-gate every lane until the emitter improves, which is their call and not a
technical one.

## The sweep the fix makes possible

`module#init` was findable because something calls it *unconditionally*. Any
other body dropped by that cascade and referenced only from a napi wrapper is
silently absent instead — a missing export rather than a failed load, which no
amount of `require` checking finds.

Now that the drop is recorded, the list is the census. Across eight modules it
drops **66** bodies: `process` 16, `http` 16, `fs` 12, `timers` 9, `util` 5,
`events` 5, `stream` 3, `buffer` 0. Twenty-five of twenty-six modules loaded
throughout, which is the condition under which the rest stays unnoticed.
