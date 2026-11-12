# Disk promises, #708

The captured pool status promised **128,346,439,680 bytes (119.5 GiB)** to four
free, unbuilt checkouts. Under active-lease accounting those four checkouts
promise **zero bytes**. A free checkout is not a commitment to build.

The previous forecast was 32,086,609,920 bytes per tree, from the largest
whole target. The measured cold inner route allocates 7,252,877,312 bytes:
5,894,328,320 in nts-dev and 1,358,548,992 in Clippy. The combined forecast rounds
once to 7,516,192,768 bytes (7 GiB). The source and 572 samples are in
[the tool-written row](../../../results/builds/cold-inner.json).
The recorder ran Clippy, built nts-cli, and built workspace tests without running
them. All three commands completed successfully. The measurement's source is
1345d0e7d82e2371044b2cdd42cbda5a7c61360e.

The controls replay four free cold trees, two active cold leases, concurrent
takes competing for two promises, partial declared output, 77 GiB of evidence,
obsolete debug output, completed owners, dead/reused process identity, future
state preservation, and temporary admission observing the same build promises.

This slice changes accounting. It does not remove the obsolete debug profile
or other build artifacts; #709 owns approved automatic reclamation. Capture
allocation claims and their simultaneous-request race remain #748.
