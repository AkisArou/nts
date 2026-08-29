# 0020 — A name is resolved in more places than it looks

`["record"]` names the member `record`. So does `"record"`, and so does
`record`. There is nothing computed about a literal in brackets: it is how a
class declares a member whose name the bare grammar will not take, which is why
node's own `internal/errors` writes `get ["constructor"]()` — `get
constructor()` is a type error.

The compiler refused all three of the bracketed and quoted spellings. It was
the largest single refusal in the node profile after the unrepresentable-type
family: **146 instances of "a method with a computed name"**, of which **62
were literals** and now lower. The remaining 84 are names the running program
decides (`[kSymbol]`, `[Symbol.iterator]`), and those stay refused for a
reason given below.

## The first attempt compiled and returned `nan`

A name is asked for in more places than it looks. Fixing two of them produced a
method the emitter named and no call site could reach, and the failure surfaced
as a wrong number rather than as an error.

There are two that decide *which member*:

- the function a member is **emitted** as, in `lower_method_of`
- the table a call site **finds** it through, in `collect_hierarchy`

and both the method path and the accessor path go through the second, so
they are two, not three. Everything now goes through one `literal_name`, and
`name_node` says which child of a declaration is spelling the name at all.

**The name comes from the symbol, not from the text.** The decoder carries no
text on a literal. The checker carries the *symbol* the name binds, and its
name is right for every spelling — `"quoted"`, `["bracketed"]` and `[0]` all
bind a symbol called what they say. Reading the literal's *type* works for
`["bracketed"]` and not for `"quoted"`: the checker gives a bare string-literal
member name the member's own type, which is a function. Taking the symbol also
means the compiler and the checker cannot disagree about which member a call
site meant, because it is the same name TypeScript does property lookup by.

## The use site is the same question

`o.x` and `o["x"]` are one thing said two ways, and their node shapes already
agree: an object beside a name. What separated them was the kind of the name
node. `names_a_property` answers for both, and three readers ask it — the read,
the method call, and the assignment target.

The object's type is what keeps `xs[0]` out. An array index is also a literal in
brackets and means something else entirely, so the predicate asks the checker
what the *receiver* is rather than what the brackets contain.

## Why a computed name stays refused

`[kTag]` and `["kTag"]` are different members. Resolving the first by the
identifier's text puts them in one slot, and the second silently overwrites the
first. The first version of this did exactly that: it recursed into the
brackets and accepted whatever text it found, so a `unique symbol` member
lowered as a plain field. A computed name wants a property map rather than a
field, and that is a feature, not a name resolution.

## The setter was returning a number it never produced

Found by the differential on the new example, and worth writing down because
the failure mode is the worst one a compiler has: it compiled, every test
passed, and the answer was wrong by a constant.

`declared_return` has a fallback that scans a declaration's children for
"whatever is neither a parameter nor the body" and calls it the return
annotation. For `set ["size"](n: number)` there is no return annotation, and
the scan found the *name*. The setter came out declared `-> f64` with a body
that returns nothing, so lowering closed it with `Terminator::Unreachable` and
the emitter rendered that honestly:

```c
double Registry__set_size(NtsObj_Registry * v0, double v1) {
    v0->count = v1;
    __builtin_unreachable();
}
```

Which is a licence for the C compiler to compute anything at all in the caller,
and it took it: `registry.size + registry[0]()` came out as `n + 4` instead of
`3n`.

Two fixes, because they close different holes. The scan now excludes the name
*node* rather than guessing by kind — a plain setter had been getting `void`
only by the accident that its name is an `IDENTIFIER`, which the filter
already dropped. And a set accessor's return type is now `Void` by
construction, from the language's rule rather than from reading the
declaration.

## The hole this leaves

`Terminator::Unreachable` means two different things, and the difference is
exactly what let the above through:

1. *control provably does not arrive here* — after a `throw`, and the default
   arm of a resumed generator's state dispatch;
2. *the lowering had nothing to say* — falling out of the end of a function
   that owes a value.

The second is only sound when the block is unreachable, which is true for
`while (true)` and false for a wrong return type. The verifier cannot tell
them apart today, so any future lowering bug that gives a function the wrong
non-void return type becomes silent undefined behaviour again. Separating them
is a terminator variant and about twenty match arms; it is not done, and it is
the right fix rather than a reachability heuristic, because a reachable
`Unreachable` is legitimate in case 1.

## The same shape, four more times

The corpus run that followed found four defects with nothing to do with
names, and every one of them is the same mistake: **something that has to
happen at every site of a kind, written once per site.** Two were in the row
the README says must stay at zero.

**An omitted argument for an optional parameter.** `f(a?: string)` called as
`f()` emitted a call one argument short of the function it called, and the
verifier caught it as `CallArgumentCount`. There was already machinery for the
neighbouring case — `f(a = 1)` evaluates the default at the call — and an
optional parameter fell through it, because a parameter with no initializer
was skipped rather than filled. It only became reachable when `string |
undefined` got a representation: while the union was refused, the declaration
never lowered, so no call to it existed to be wrong. `undefined` is a value
like any other and needs a home — the null pointer for a reference, the
`undefined` tag for an erased value, and nothing for an `f64`, which is now
refused in those words.

**A value asserted to be `never`.** `{ from: "x" as never }` stores a string
into a field whose declared type is uninhabited. The assertion typechecks and
is false; the layout is shared by every value of the type, so representing the
field by whatever the first store happens to be is not available. Refused at
`coerce`, which is the one place a value meets a slot of a different type.

**A static's initializer has to be a constant expression.** A module-scope
`unknown` emitted

```c
static NtsValue held = nts_value_of_undefined();
```

which is not C. The same call compiles everywhere else, which is why nothing
caught it: the accessor is right in every position but this one. There is now
an `NTS_VALUE_UNDEFINED` initializer macro beside the function, and an example
with a module-scope `unknown` in it, because the corpus is not part of the
gate and this class of defect is invisible to the HIR.

### And the one that mattered most

Adding that example immediately found a fourth: `held = n` where `held` is
`unknown` stored an `f64` into an erased global. `coerce_element` already
carried a comment saying it was found "four conversion sites after the first",
which is the whole diagnosis written down and not acted on. Conversion was
living at each store site that happened to think of it.

It now lives in one: `coerce_to_slot`, which `write_place` calls for every
kind of place. A store is the only thing that reaches a slot, and this is the
only thing a store goes through. A setter is deliberately not a slot — it is a
call, and its argument is converted where every other argument is.

Writing it that way immediately turned up a fifth, which is the point of
writing it that way: a *binding*. `let held: unknown = "text"; held = n`
rebound `held` to the raw double, so a later `typeof held` matched neither the
primitive path nor the erased one — and two assignments in two branches met at
a join with no common type at all. The declaration site had already been fixed
for exactly this, with a comment saying so; the assignment site had not,
because it is a different function.

A binding is an SSA value rather than a slot, so nothing but the declaration
records what it is meant to hold, and a local's `SymbolRecord.ty` is `None`.
The type is read from the assignment *target*, which is where the checker
gives the declared type rather than the narrowed one — the left of an
assignment is not narrowed by what came before it, because the assignment is
what does the narrowing — and carried in `Place::Binding` so the store has it.

## The checker's name and the written name

The same theme, and the largest instance of it. `#count` is interned by the
checker as `__#1@#count`: a file's private names share one symbol table, and
the number keeps two classes that both declare `#count` apart. A layout is per
type, so nothing downstream needs the number — and everything downstream is
looking for what the program wrote.

Carrying the mangled form through meant **every read of a private field was
refused**. It also made `own` false for every private member, because that is
decided by comparing against the *declaration's* name, which is never mangled.

It was invisible for as long as it was, because the refusal was anonymous:
`a property the type does not declare`, one bucket holding a member of an
unmodelled library type, a property of a type whose decomposition stopped
short, and an actual absence, all reading the same. Naming the property and the
type it was looked for on turned 133 instances into a list whose first twenty
entries were `#record`, `#index`, `#otherSide`, `#localAddress`, `#callback`,
`#state` — 102 of the 133 in one glance.

Stripping the prefix in the frontend took the node profile from **391 lowered
functions to 453**.

## A private name is a name, and it is not an identifier

`#check` is a `PrivateIdentifier` — a node kind of its own, not an identifier
spelled oddly. The resolver read identifiers, string literals, numeric literals
and computed names, and did not read that one. So a private *method* had no
name at all.

A private *field* was fine, which is what kept this hidden: a field's slot
comes from the checker's property list, and only a method's name goes through
the resolver.

What it cost was not the method. **Every member declared after it in the same
class was then neither lowered nor refused** — twelve of `URLSearchParams`'s
methods among them. Nothing tested for that. What noticed was the conservation
law in `hir::unaccounted`, which asks whether every function the checker knows
about was either lowered or refused, and which exists for exactly this: *a
function that vanishes takes its callers' correctness with it while the
compiler reports success.*

Two more readers had the same gap, and one of them had a second bug behind it.
`lower_static_call` looked for the first identifier among a method
declaration's children — which is the right node only because a
`MethodDeclaration` has no other identifier before its name. Written as "the
last child" it would have found the body; written as `member_name` it is the
same question the other two readers ask.

## What the conservation law was reporting instead

Fifty-one reports, and forty-three of them were the law being wrong rather than
the compiler:

- **Thirty-one** were functions declared inside something that was itself
  refused — an object literal method inside a function refused for an
  unrelated reason, where the refusal's span covers the offending expression
  and not the method three lines below it. Nothing was emitted for the
  enclosing function, so nothing vanished.
- **Thirteen** were *generic* functions that nothing instantiates. A generic is
  lowered once per instantiation and not at all as itself, and
  `lower::function_copies` already says so in those words — "one that nothing
  calls is dead, and lowering it would report a refusal for a program nobody
  wrote". The law was contradicting a decision the lowering makes deliberately.

The law still catches what it was built for. A method of a class expression
disappears while its enclosing function lowers *successfully*, so no refusal
covers either — which is why the rule is "declared inside something that was
refused" and not "declared inside something that failed to emit".

The remainder is eight, and they are real.

While fixing it, the statement-level diagnostic started pointing at the
statement. It says *"this statement, which module evaluation therefore
skips"* and pointed at the expression inside it, which is a different claim.

## What it did not buy

The whole-profile function count did not move: **171 both before and after**,
1661 refusals both ways. The 62 members that now resolve are inside modules
blocked by larger things — `a class of unrepresentable type` alone is 160 —
so a member that stops being refused just lets its module fail somewhere else.
The gain is real and it is not yet visible at the profile level, which is the
same shape as the optional-properties result in 0019.
