# The row could not be ranked while it was one sentence

The refusal census's number one row, by distinct named things, across every
module:

```
things  sites  mods  root
    57     61    23  `X` on a union, whose members lay their fields out differently
```

It is the largest single thing in the compiled axis's way, it had a blocker
fixture with a designed solution, and the ledger cited it in three places. It is
also not, mostly, about unions.

## The message asserted its cause

`not_a_length` produces it whenever the receiver's HIR type is `Erased` and the
member is not `length`. That is the entire test. The sentence — *whose members
lay their fields out differently* — is a claim about union arms that nothing
checked, and `shared_field` next door had already computed the answer and thrown
it away.

It was caught lying once before, and the note is in `present_of`'s own doc:

> `h?.value` on a `Held | null | undefined` [was refused] as "a union whose
> members lay their fields out differently" — said of a union with exactly one
> object in it.

That was read as one site's wording problem. It was the row.

A probe separating six shapes found the claim false for three more. A getter
every arm declares is not a field in any of them. A method *call* on a union
does not reach this at all — it reports `a method call on something without
methods`, a different census row. And the shape the message is named after
lowers: `SharedFieldGet` handles a field every arm puts at the same index.

## What it is, once it is asked

`shared_field` declines for four distinguishable reasons and now says which.
Across `util`, `stream`, `http`, `fs` and `buffer` — 133 sites, and in the
census's own unit of distinct named things:

| things | sites | cause |
|---|---|---|
| 25 | 97 | an **intersection** that erased |
| 5 | 21 | a union one of whose members has no layout |
| 4 | 7 | a union whose members share no leading field |
| 3 | 7 | a field past the prefix its arms agree about |

**Three quarters of it is intersections**, which the census already reports
*separately* as `intersection-from-two-narrowings`, 20 things across 18 modules.
The number one row was inflating itself with the content of another row, and
both were being ranked as though the two numbers were disjoint.

The genuinely union-shaped remainder is twelve things across five modules, and
the bottom two rows of that table are the correct refusal the blocker fixture
already describes and argues should stay.

## Why this was worth a day's suspicion and not a day's building

The queue said to build the top row. The top row's fixture had a designed
solution, a measured JVM cost for the alternative, and a record behind it. Every
signal said implement.

What it needed was for **one number to be split before it was spent**. The
census's own footer says a row "is a place to start reducing, not a defect" and
that "one message covers several causes as readily as one cause wears several
messages". That is exactly right and I had read it several times; what it does
not say, and what this adds, is that **a message which names a cause is the
dangerous kind**, because it reads as though the splitting has already been
done. `a method call on something without methods` invites the question "which
methods?". `whose members lay their fields out differently` answers it in
advance, wrongly.

## The check

Ask of any diagnostic that ranks high: **what did the code test before it said
that?** Here, `ty == HirType::Erased` — and the sentence named a property of
union arms. The gap between the two is the number of causes hiding in the row.

Related: [0306](0306-tightening-a-rule-drops-what-it-covered-by-accident.md) is
the same arithmetic on a rule rather than a message, and
[0308](0308-agreed-on-every-case-and-wrong.md) is a fixture whose observable
could not see what it was measuring. All three are one shape — a claim stated
over a domain nobody enumerated — and this is the one that cost the most,
because the claim was in the output rather than in the source, so every
instrument downstream inherited it.
