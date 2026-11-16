# Run-owned oracle image retention (#797, part 1)

The implemented scope is the run's own drained close. A newly created image
has an immutable acquisition receipt under its enclosing temporary. The receipt
binds the actual temporary, the image and its parent directory identities.
Exclusive creation prevents adoption of an older image. Borrowed parent images
and ready-image hits acquire no new receipt. Failed close removes only a
registered tree, retaining ready.json, semantic.json, ledgers and other evidence;
its report and retention row name the path and allocated bytes removed.

A registered closed temporary is one completed lifetime. Reopening it through
NTS_GATE_RUN_DIR used to let preparation consume its old ready image while the
root remained eligible for pruning. Fresh acquisition now refuses that root by
name and asks for a new directory. Automatic queue retries, re-measurements and
bisect probes already allocate new runs; imported landing evidence contains
verdicts, contracts and binary observations rather than an installed image.
Live inherited handoffs and retries before close remain within one lifetime.

## Proposed interrupted recovery: not implemented

Dead-owner recovery is a new automatic deletion kind awaiting the user's
approval. No discovery, dead-owner classification or recovery is implemented
by part 1. Existing images and issue scratch remain outside its adoption scope.

A future recovery owner would require a versioned liveness registration before
installation writes, in addition to the immutable image acquisition facts. It
would bind a process PID and birth identity and the run's owned execution scope
by its kernel identity. The current version-1 image receipt alone would never
supply recovery authority. Parent-image borrowers would retain that lifetime
until their own work and helper completion had drained.

Recovery would require the original owner to have ended, its exact scope to be
empty or gone, and a complete live-process observation to find no image holder.
A shared controller scope, unavailable observation, reused PID, changed scope
identity, live borrower or unknown state would keep the image by name. An
exclusive cleanup claim would prevent new handoffs during the decision. The
owner would recheck the run, all ancestors and image identities immediately
before removal, using the same owned remover as explicit close.

The only removable object would be the explicitly registered image tree.
Ready and semantic records, call ledgers, logs, source trees, corpora and
unregistered images would remain. This would extend the existing run-temporary
owner; it would not infer ownership from folder names or scan historical caches
for images to adopt. Approval and a concrete liveness proof are prerequisites
for implementing that recovery path.
