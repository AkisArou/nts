# Integer-loop attribution

The direct control removes conversions rather than adding them: work plus its retained/inlined mergePositions callee has 12 scalar integer/double conversion sites before and 2 after on both backends. None remain in its hot loop. Map-top-k removes 20 conversion sites and stableStrings removes 10 on each backend. Integer Min/Max selects compile to cmov, rather than new data-dependent branches.

Direct-control branch misses are only about 0.001 to 0.002 per call; that increase is too small to explain the time loss. The integer code uses more GPRs and a different unrolled control shape, and profiles move from mixed FP/integer instructions to integer additions, comparisons and loop bookkeeping. There are no hot-loop stack spills. The LLVM integer shape saves/restores six callee-saved GPRs instead of four; the small function makes this fixed overhead visible. Ordinary cycle samples can skid, so instruction-level percentages locate work without proving an exact stall attribution.

The new sort-objects profiles put 83.01% of C cycles and 84.09% of LLVM cycles in work. The visible comparator remains inlined on both. The planned separate C comparison-chain change is dropped: the earlier C/LLVM gap went away with the double cursors.

Open lead: if a real workload exhibits the small-function register cost, investigate whether the i64 value widths can narrow to i32 where proved. That is not implemented here. No workload/type routing or new profitability mechanism is included.

Raw conversion listings, four direct-control profiles and both new sort profiles are under /home/akisarou/.cache/nts-scratch/runtime-20261027/integer-loop-facts/ab.
