# Lessons

What working on nts has taught, one rule and its reason per line. They were
learned the expensive way, mostly by sessions that measured the wrong thing,
trusted a green result that could not have been red, or broke a peer's work.

Read the topic before working in it:

- [measurement.md](measurement.md): what a number means, and when it means less than it says.
- [fixtures.md](fixtures.md): making a test that fails for the reason you think.
- [soundness.md](soundness.md): reasoning about whether the compiler is right.
- [concurrency.md](concurrency.md): working beside other sessions in one checkout.
- [backends.md](backends.md): facts specific to one backend or runtime.
- [memory.md](memory.md): ownership, reference counting and lifetimes.
- [machine.md](machine.md): the shell, the toolchains and this machine.

The always-rules are in [`AGENTS.md`](../../../AGENTS.md). A lesson that every
contributor must follow every time belongs there instead. One that stops being
true is deleted, not annotated.
