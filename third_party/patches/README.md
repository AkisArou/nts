# Carried patches

Changes this repository keeps on top of a vendored dependency, applied to its
working tree and never committed into it -- because `third_party/typescript-go`
is a submodule pinned to `microsoft/typescript-go` `main`, and a submodule's
content cannot be committed from the parent repository.

So the patch *file* is the tracked artefact and the applied state is derived.

## Using them

    sh tooling/bootstrap/bootstrap.sh

applies every patch here and rebuilds `target/tsgo` if any of them is newer than
it. That is the only thing to run, and it is idempotent: a patch already applied
is detected and skipped.

Run it after pulling a change to this directory. **A stale `target/tsgo` is the
one failure mode that is not loud** -- the compiler asks the frontend a question,
gets the pre-patch answer, and is simply wrong about the program. Which is why
each patch owes the two guards below rather than a line in a document.

## Adding one

1. Edit the submodule's working tree. Keep it **additive**: a new field, a new
   method, a value reported where it previously was not. A patch that changes an
   existing answer makes every rebase a semantic question rather than a textual
   one.
2. `git -C third_party/<dep> diff -- <paths> > third_party/patches/<name>.patch`,
   and put a header above the diff (`git apply` skips a preamble) saying: what it
   does, how to apply and build, **why**, why a change of ours could not do the
   same job, what to restore if the upstream code has moved, and whether it has
   been sent upstream.
3. Verify the file reproduces the tree:
   `git -C third_party/<dep> apply --reverse --check ../patches/<name>.patch`.
4. **A test that fails when a submodule bump drops it.** A carried patch's whole
   hazard is that nothing goes red when it disappears: the build succeeds, the
   dependency is self-consistent, and only an answer deep inside our own compiler
   changes. So assert the *invariant* against the pinned source -- not the
   patch's text, which a cosmetic upstream edit would break for no reason.
   `compiler/frontend-ts/src/tsgo/types.rs`'s
   `the_pin_reports_object_flags_for_every_type` is the pattern, and
   `symbols.rs`'s `every_flag_matches_the_pinned_tsgo_source` is the older
   sibling it borrows its discipline from: *not skipped when absent, because a
   check that passes by not running is the failure it exists to prevent.*
5. Any other place that builds the dependency applies the patch too. Today that
   is `tooling/bootstrap/bootstrap.sh` and `.github/workflows/ci.yml`, and
   `grep -rn 'go build' tooling .github` is how to find out whether it is still
   two.

## Removing one

When upstream takes the change, bump the submodule and delete the patch -- the
guard test keeps passing, because it asserts the invariant and not who provides
it, which is the point of asserting the invariant.
