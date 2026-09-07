# The guarantee every passing test was blind to

The durable store commits by writing a temporary, syncing it, renaming it over
the target, and then syncing the *directory*. The last of those four is the one
this record is about, because it is the only one whose absence nothing notices.

## Two syncs, and why the second looks redundant

`fsync` on the file makes the bytes durable. It does not make the *rename*
durable: the directory entry that gives those bytes their name lives in the
parent directory, and that is a different inode with its own dirty pages. A
power cut between the rename and the directory's writeback loses the entry and
leaves the value under its temporary name — where nothing looks for it.

So a store with one sync still never shows a partial value, still replaces
atomically, still passes every case about what a key holds. It is wrong only
after a power cut, and only sometimes.

I wrote 47 functional checks before noticing that **not one of them can fail if
the directory sync is deleted.** That is not a gap in the checks; it is what the
guarantee is. No test that does not cut power can observe it.

## What I did instead of cutting power

Checked the cause. An `LD_PRELOAD` shim stands in front of libc and reports the
calls a commit makes:

    SHIM fsync  .../ns/k.1.nts-partial
    SHIM rename .../ns/k.1.nts-partial -> .../ns/k
    SHIM fsync  .../ns

Three calls, in that order. The test asserts exactly that sequence, and it is
honest about what it is: not evidence that the value survives a power cut, but
evidence that the mechanism which would make it survive is present and ordered.

**Both sabotages are caught and the functional suite sees neither.** Deleting
the directory sync gives `["fsync file", "rename"]`. Moving the sync to before
the rename — the subtler one, because the call is still there and a reviewer
reading the diff sees a sync — gives `["fsync file", "fsync directory",
"rename"]`, which is useless: it syncs a directory that does not yet contain the
entry. 47 checks stayed green through both.

## The measurement that removed a class

Separately, and the reason this is one file rather than two: I was going to put
the directory sync behind a platform seam, because it looked like it needed
`android.system.Os.fsync` and therefore the SDK. On an API-26 device:

    FileChannel.open(dir, READ).force(true)                        ok
    android.system.Os.fsync on the same directory (the control)    ok

The portable route works, and the control is there so that a failure would have
been about the route rather than about the directory or the permissions. So the
seam does not exist, the store names no SDK member, and the desktop suite is
evidence about ART rather than a proxy for it.

## What I take from it

**"All the tests pass" is a statement about what the tests can see.** The four
lines of `commit` are not equally observable, and I had no way to tell which was
which until I asked what a deletion would do to each. Three of them fail loudly.
The fourth fails on a machine that loses power, months later, to somebody else.

The general move is the one `docs/records/0181` made for `volatile` on x86:
where an invariant cannot be falsified by execution on the hardware in front of
you, assert its *cause* instead, on the machine of whoever would break it. That
record needed an ARM device to do better. This one needs a power supply, and
until there is one the shim is the whole of the evidence — which is why it says
so in its own doc comment rather than in a commit message nobody re-reads.
