# The safety check cried wolf on a good commit

`commit-mine.sh` exists because a private-index convention once removed 1121 of
1124 files from the repository in a single commit. Its last check compared the
number of files the commit touched against the number of paths named:

    if [ "$touched" -gt "$wanted" ]; then
      echo "commit-mine: REFUSING -- $touched files changed, $wanted were named:"

A correct commit naming two fixture *directories* and three files reported

    commit-mine: REFUSING -- 7 files changed, 5 were named

and listed the seven, every one of them intended. Two directories held four
files between them. The word REFUSING was printed **after** `git commit` had
already run, and that branch of the message did not say so -- the branch above
it does, which is how the asymmetry survived.

## Why this is worth a record and not just a fix

The count was a proxy for the invariant, and the invariant is *containment*:
every file the commit touched should be one that was named, or under a directory
that was named. Counting agrees with containment only when no argument is a
directory, which was true of every commit until it wasn't.

The failure mode is the one that matters for a guard like this. A check that
refuses a good commit does not stay a nuisance -- it teaches the person reading
it that REFUSING sometimes means nothing, and the run it exists to protect
against is precisely the one where somebody reads past it. **A false alarm in a
safety check is not a smaller version of a missing check; it is a way of
removing the check while leaving it in place.** This one had fired correctly
before, which makes it worse rather than better: the wolf was real once.

Containment says the same thing about the case the script was built for, because
a file nobody named cannot be under a path somebody named.

## Controlled, including the case a naive fix gets wrong

    a directory named, four files under it        accepted
    a file outside every named path               REFUSED: runtime/node/os/shape.mjs
    a trailing slash on the named directory       accepted
    a prefix that is not a directory boundary     REFUSED: b/nested-other/src/main.ts
    an exact file named                           accepted

The fourth is the reason the test is `"$path" | "${path%/}"/*` and not a prefix
match: `b/nested-other` starts with `b/nested` and is a different directory. A
`case` on the string alone would have accepted it, and the check would have been
wrong in the *permissive* direction -- which is the only direction that can lose
files.

Run against the loop itself rather than against real commits, because the
failing case has to be a commit that touches something it should not, and
producing one to prove the guard works is the thing the guard exists to prevent.
