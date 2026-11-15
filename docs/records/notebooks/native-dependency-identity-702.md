# Native dependency content identity across extraction roots (#702)

The native invocation owner maps its verified embedded bundle to `/nts/node-deps/<bundle SHA>` for file macros and debug information. Its identity records a versioned policy and virtual root. Bundle observations replay at the caller's extraction root; external observations retain absolute paths and content validation. Caller prefix maps refuse by name in flags, leading arguments and config. Shipped assertion strings expose the virtual bundle path.

## Deciding comparisons

Each pair uses the same source, tools, flags and explicit environment, under extraction roots with different names and lengths. This is byte and identity evidence, with no speed claim.

Main a4118b90's owner produced different Clang libuv archives: 1,658,390 versus 1,666,022 B, SHA-256 8b03f3d132e088ef5380cbd567dbe0eff08f2ec39af20edc8fe45b983c51e7fc versus 5128b96d94d9504d67dada591ce38e0681d6c20ebb8ac6a2525b82a1a4bd2fdf. Only invocation field 6 differed. Nineteen of 35 objects in each arm carried the physical root in allocated strings. The before executable was built by retained green #727 inner-v5; its relevant native-owner source equals that main revision and its bytes were fenced before/after.

All final pairs below have identical full archive bytes and identical invocation bytes within each pair, with physical roots absent. Host native-object and Zig pairs pass `-g` explicitly. The exact CLI ThinLTO pair retains its production flags and libuv's recipe-owned `-g`; its actual debug metadata participates in the bitcode archive comparison.

| Driver and route | Archive bytes | Whole archive SHA-256, both roots | Invocation SHA-256, both roots |
| --- | ---: | --- | --- |
| Clang, host ELF | 1,641,734 | 1bc7d95476c7c124facac20bc89716f5f526359b64810ee78c8a955897483e3a | 2097449896bde84966cce62d104604a961c10d4986ab8780a03426cdba0cd1f1 |
| GCC, host ELF | 1,878,014 | 55318c241d7434a66ccd83bad04b75df50660d17ac0a973fad1c4f8e8c2b1ab0 | 9390d909712ecc33b9d3f2f6607bb92becef9d034ef4f6d6bd703e389567ff35 |
| Zig aarch64-unknown-linux-musl | 1,900,742 | e9bb9eaa0cc91a0185d2802b44bdf1587c8e907a78110bbe30532c7d9bca676c | d5b67ffd284f68ae9f9b5767b4158197bd3c968665050b5bee7b76b7640dd5a1 |
| Zig x86_64-pc-windows-gnu | 1,667,242 | 70fa174aa208e64fa5569650559a12cfb787e3eb1f1ec3ca7407c4abf4800a8b | 8b4f5bb2bbd505d2046db7da30acc037db7564490422df83a293f7e33fef1388 |
| Zig x86_64-apple-darwin | 1,195,288 | 343d4d777674a182295131719051fd0f107efe5d1a95f8bdb0a00e2bc7444780 | cc046d01b52f7fd0fb2ece74285b3494f37d964873be6b2b5c4a89cb6e9561fa |
| Clang exact CLI ThinLTO x86_64-unknown-linux-gnu | 1,526,022 | 03a0e76c99628e56d8fbed94919d19c4adc21ff231add0c4e23c0514e131b309 | f53823ed013e02eca67ecd8da93a6d1c0a468dec811cb4773e79a8a1e4cc0b9b |

Host controls also verify deterministic ar metadata, sorted members, allocated virtual assertion strings and debug payload. Relocating a complete private cache preserves an epoch-stamped object, proving reuse without recompilation. Source mutation still refuses; a changed transitive external header recompiles under the same key; flag or compiler changes select another key. Nine Zig target routes execute the real tiny debug-object support probe; they are not nine full-library archive comparisons. The three cross-format full-libuv pairs plus the exact CLI ThinLTO pair are a separate admitted manual proof.

## Search and CodeView findings

| Finding | Actual observation | Correction and deciding control |
| --- | --- | --- |
| GCC working-directory marker | Main's parser took the parent of the marker ending in //; adding an unrelated private source generation moved key 5eaf38dc… to 278278fd… while rebuilding a byte-identical archive | Decode C-quoted numeric markers, exclude only the directory marker; fixed real GCC control preserves the key and object stamp |
| Zig materialized stdin | Cross V1's search field 12 moved on all three routes: the first primary input named a Zig tmp file, whose mutable parent was mistaken for a header-search root | Exclude the exact input named by the first numeric marker, including its return markers; a paired control retains a real forced header beside it; final three full pairs have equal identities |
| ThinLTO representation and source filename | Supported V1 exposed the actual CLI bitcode route: raw tag searching could not read the representation, and the IR source_filename itself retained the physical input | Compile ./bundle-relative inputs from the owned cwd and map their macros; decode BC/wrapped BC with the same compiler and unchanged route flags; decoder control positively inspects source_filename, and the full libuv pair retains exact CPU/ThinLTO flags |
| COFF CodeView | Cross V1 retained physical command text and S_OBJNAME; compilation-dir alone did not remove them | Context owns -fdebug-compilation-dir, -gno-codeview-command-line and a virtual -object-file-name derived from the bundle-relative input; actual UV flag isolation and final full COFF archive pair prove removal |

The GCC issue is latent on main, not observed production churn. A read-only fenced inventory of today's real cache found 1,596 invocation records and 91 distinct GCC keys, with zero debug-enabled search probes: zero existing keys in that snapshot trigger this particular marker defect. Recipe object cflags do not enter that search query. No shared cache entry was modified by the inventory.

COFF flags apply only to COFF object commands. Other formats keep their own supported command vocabulary. Source operands are ./bundle-relative from the bundle cwd, keeping LLVM source_filename stable. The one support probe per Context compiles a tiny -g object through the same owner in an exclusive scratch claim outside the hashed bundle. It requires tagged FILE and BASE_FILE results and absence of both physical namespaces, including target separators and UTF-16 spellings. BC/wrapped-BC output is decoded from stdin by the same compiler with unchanged route flags; only printer comments are excluded, while source_filename and represented string bytes remain checked. The shared publication scratch owner joins cleanup with the primary result and never publishes or removes a foreign target. Actual macro-refusal and scratch success/error controls verify those boundaries.

## Generations and retained state

Main-era manifests are unversioned. Main invocation field 6 is the physical directory string; the new field is ["bundled-source-paths-v3", virtual_root]. The whole record hashes to archives/<key>/<target>/complete.json, so version-2 manifests exist only under new policy keys: no main manifest is opened or migrated in place. A future version refuses before typed decoding or diagnostic writes; the private version-3 control preserves the incompatible manifest, sentinel invocation and archive exactly.

The native cache has no automatic eviction policy. Old generations are left untouched. #697 owns access to the named shared cache and its fixture environment; this change owns content identity and observation replay. No new deletion policy is introduced.

## Proof and scope

| Proof | Actual result |
| --- | --- |
| Focused native/publication controls | 6 path/search/IR-string + 7 real native integration + 3 publication unit + 10 publication integration; layout, timing, host and strict all green |
| Scoped gate Clippy | nts-build and nts-publication, all targets; green |
| Required fresh inner | PASS  fmt              3s; PASS  clippy           2s; PASS  build            5s; PASS  tests          311s |
| Cross-format manual pairs | ELF, COFF, Mach-O and exact-CLI ThinLTO: full archives and invocations byte-identical |
| Supported --here | 16 PASS gate rows plus PASS build, canonical, no experiments, complete cleanup and diagnostics |

Proof source: 5445a9a60af7d20d4f51c2478e229066ebc1913c. Raw evidence: /home/akisarou/.cache/nts-scratch/702/raw-evidence-v1.json, SHA-256 d66cd0fd0cdf695fa2e5101b612f167669450401fde6d1d25db2979f8f1a595b. The finite manifest binds the deciding artifacts and Git source receipts; compiled test executables and regenerable run trees are omitted. Native-parity-v4 preserves actual fixture artifact bytes after relocation and an intentionally refused later source mutation, rather than treating the later source directory as its original snapshot. Cross-format conclusions are limited to the representative routes and libuv, and do not establish every upstream library/toolchain combination.

Excluded REDs remain in the manifest: focused V1's boundary/fixture failures, inner V1/V2 and scoped Clippy V1 lints, Cross V1's search/CodeView findings, and Supported V1's ThinLTO probe/filename failure. None supplies final successful proof.
