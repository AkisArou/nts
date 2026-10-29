# Compiler dependency attributions

Generated from Cargo.lock by `node tooling/licenses/licenses.ts --update`.
Roots: the release CLI and native frontend (until it becomes unconditional).
This conservative locked closure covers all platform/feature dependency paths.
The gate checks completeness and every full licence/notice text offline.
Ship this directory with compiler binary distributions. The nts runtime
needs no notice in compiled programs under its Apache-2.0 WITH LLVM-exception
licence. Third-party components linked into a program retain their own notices.

## Vendored code

Full texts are copied here; a distribution needs no source checkout.

| Project | Locked crates | Full texts and notices |
| --- | --- | --- |
| third_party/react-compiler | 12 | [LICENSE](texts/da6d3703ed11cbe42bd212c725957c98da23cbff1998c05fa4b3d976d1a58e93.txt) |
| third_party/tsrs | 21 | [LICENSE](texts/a7d00bfd54525bc694b6e32f64c7ebcf5e6b7ae3657be5cc12767bce74654a47.txt), [NOTICE](texts/1a4f42d83bf205aaf1b474e1a8c133cc5365003a188ba5f257d8aa4741355118.txt) |

## Vendored data

Data files the compiler carries derived tables from, declared in
`tooling/licenses/licenses.ts` because Cargo.lock cannot see them.

| Input | Licence file | Full text |
| --- | --- | --- |
| Unicode Character Database 17.0.0 | compiler/unicode/data/LICENSE | [compiler/unicode/data/LICENSE](texts/e7a93b009565cfce55919a381437ac4db883e9da2126fa28b91d12732bc53d96.txt) |
| Node 24.20.0 bundled brotli sources | build/node-deps/recipes.json#notice/brotli | [build/node-deps/recipes.json#notice/brotli](texts/3d180008e36922a4e8daec11c34c7af264fed5962d07924aea928c38e8663c94.txt) |
| Node 24.20.0 bundled openssl sources | build/node-deps/recipes.json#notice/openssl | [build/node-deps/recipes.json#notice/openssl](texts/7d5450cb2d142651b8afa315b5f238efc805dad827d91ba367d8516bc9d49e7a.txt) |
| Node 24.20.0 bundled uv sources | build/node-deps/recipes.json#notice/uv | [build/node-deps/recipes.json#notice/uv](texts/e1b5bf88a1345ad15d6b2cc171d6fe1dace8c8a5dfc24d5a0a29e49eb68e1131.txt) |
| Node 24.20.0 bundled zlib sources | build/node-deps/recipes.json#notice/zlib | [build/node-deps/recipes.json#notice/zlib](texts/00ec84eb8f9afac7c30aa1b8a7d3869fbe07b96a0c04ef9a86fcec38d4c50c1e.txt) |
| Node 24.20.0 bundled zstd sources | build/node-deps/recipes.json#notice/zstd | [build/node-deps/recipes.json#notice/zstd](texts/253ea8e54e3fcda3d6a1c26abbd7d172f27f523f452e5e706a41ff8a39eadf72.txt) |

## Embedded C components

The compiler embeds these sources. FFC is used under BSL-1.0 in compiled
programs, which need no FFC notice; its source header retains the full licence.
All upstream licence alternatives remain in the compiler distribution.

| Component | Upstream licence | Used in programs | Full texts |
| --- | --- | --- | --- |
| runtime/c/ffc | Apache-2.0 OR MIT OR BSL-1.0 | BSL-1.0 | [LICENSE-APACHE](texts/097a889aa954d04e088b790b10a4014d6189561d0a6013935a73ce3d4ddaaf06.txt), [LICENSE-BOOST](texts/c9bff75738922193e67fa726fa225535870d2aa1059f91452c411736284ad566.txt), [LICENSE-MIT](texts/e562f3f974ced7e69dd1db77b820b36bcf8f30377f1aa105723fba449c53c4e6.txt) |
| runtime/c/quickjs | MIT | MIT | [LICENSE](texts/96f73f9d2a16c21a36b418f06073be26e7d6d5e7c1bc99756b21a4f2c74ef171.txt) |
| runtime/c/zmij | MIT | MIT | [LICENSE](texts/a69b36adb8d116376bcd580772fa45f08fffecc17833cb9822532f4e4f5ec372.txt) |

## Registry dependencies

| Package | Version | Licence | Texts and notices |
| --- | --- | --- | --- |
| adler2 | 2.0.1 | 0BSD OR MIT OR Apache-2.0 | [LICENSE-0BSD](texts/861399f8c21c042b110517e76dc6b63a2b334276c8cf17412fc3c8908ca8dc17.txt), [LICENSE-APACHE](texts/8ada45cd9f843acf64e4722ae262c622a2b3b3007c7310ef36ac1061a30f6adb.txt), [LICENSE-MIT](texts/23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3.txt) |
| aho-corasick | 1.1.5 | Unlicense OR MIT | [COPYING](texts/01c266bced4a434da0051174d6bee16a4c82cf634e2679b6155d40d75012390f.txt), [LICENSE-MIT](texts/0f96a83840e146e43c0ec96a22ec1f392e0680e6c1226e6f3ba87e0740af850f.txt), [UNLICENSE](texts/7e12e5df4bae12cb21581ba157ced20e1986a0508dd10d0e8a4ab9a4cf94e85c.txt) |
| anyhow | 1.0.104 | MIT OR Apache-2.0 | [LICENSE-APACHE](texts/62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a.txt), [LICENSE-MIT](texts/23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3.txt) |
| atomic-polyfill | 1.0.3 | MIT OR Apache-2.0 | [LICENSE-APACHE](texts/a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2.txt), [LICENSE-MIT](texts/8924c88b998da95624f60eeb8705eaa581586e65b686e6d3367ffb14067b8451.txt) |
| autocfg | 1.5.1 | Apache-2.0 OR MIT | [LICENSE-APACHE](texts/a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2.txt), [LICENSE-MIT](texts/27995d58ad5c1145c1a8cd86244ce844886958a35eb2b78c6b772748669999ac.txt) |
| bitflags | 2.13.2 | MIT OR Apache-2.0 | [LICENSE-APACHE](texts/a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2.txt), [LICENSE-MIT](texts/6485b8ed310d3f0340bf1ad1f47645069ce4069dcc6bb46c7d5c6faf41de1fdb.txt) |
| byteorder | 1.5.0 | Unlicense OR MIT | [COPYING](texts/01c266bced4a434da0051174d6bee16a4c82cf634e2679b6155d40d75012390f.txt), [LICENSE-MIT](texts/0f96a83840e146e43c0ec96a22ec1f392e0680e6c1226e6f3ba87e0740af850f.txt), [UNLICENSE](texts/7e12e5df4bae12cb21581ba157ced20e1986a0508dd10d0e8a4ab9a4cf94e85c.txt) |
| camino | 1.2.5 | MIT OR Apache-2.0 | [LICENSE-APACHE](texts/a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2.txt), [LICENSE-MIT](texts/23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3.txt) |
| cobs | 0.3.0 | MIT OR Apache-2.0 | [LICENSE-APACHE](texts/c6596eb7be8581c18be736c846fb9173b69eccf6ef94c5135893ec56bd92ba08.txt), [LICENSE-MIT](texts/e0cfa1006a64520633de6bfbf563f5b1bea04ef0c5b73f049681931fa297dda3.txt) |
| critical-section | 1.2.0 | MIT OR Apache-2.0 | [LICENSE-APACHE](texts/a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2.txt), [LICENSE-MIT](texts/fee6bdac4b917351332567b9fd5013c2ef3c847dd113fd6216cf28e96637a157.txt) |
| crossbeam-deque | 0.8.8 | MIT OR Apache-2.0 | [LICENSE-APACHE](texts/a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2.txt), [LICENSE-MIT](texts/5734ed989dfca1f625b40281ee9f4530f91b2411ec01cb748223e7eb87e201ab.txt) |
| crossbeam-epoch | 0.9.21 | MIT OR Apache-2.0 | [LICENSE-APACHE](texts/a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2.txt), [LICENSE-MIT](texts/5734ed989dfca1f625b40281ee9f4530f91b2411ec01cb748223e7eb87e201ab.txt) |
| crossbeam-utils | 0.8.23 | MIT OR Apache-2.0 | [LICENSE-APACHE](texts/a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2.txt), [LICENSE-MIT](texts/5734ed989dfca1f625b40281ee9f4530f91b2411ec01cb748223e7eb87e201ab.txt) |
| displaydoc | 0.2.7 | MIT OR Apache-2.0 | [LICENSE-APACHE](texts/a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2.txt), [LICENSE-MIT](texts/23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3.txt) |
| dragonbox_ecma | 0.1.12 | Apache-2.0 WITH LLVM-exception OR BSL-1.0 | [LICENSE-Apache2-LLVM](texts/624d724f544656ff2f965b3b41e3050133fa042d80292a05330c786a12808cb9.txt), [LICENSE-Boost](texts/c9bff75738922193e67fa726fa225535870d2aa1059f91452c411736284ad566.txt) |
| either | 1.19.0 | MIT OR Apache-2.0 | [LICENSE-APACHE](texts/a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2.txt), [LICENSE-MIT](texts/7576269ea71f767b99297934c0b2367532690f8c4badc695edf8e04ab6a1e545.txt) |
| embedded-io | 0.4.0 | MIT OR Apache-2.0 | [LICENSE-APACHE](texts/a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2.txt), [LICENSE-MIT](texts/423e1c4900b3fbb41cda3e34530b2597d50c2e61473e18c085756c507e46fe1c.txt) |
| embedded-io | 0.6.1 | MIT OR Apache-2.0 | [LICENSE-APACHE](texts/a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2.txt), [LICENSE-MIT](texts/47674f8b7d98c232c6f81346c4cfe48933d913a9e257d7a522ad9f42e3dd61e1.txt) |
| equivalent | 1.0.2 | Apache-2.0 OR MIT | [LICENSE-APACHE](texts/a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2.txt), [LICENSE-MIT](texts/7365cc8878a1d7ce155a58c4ca09c3d7a6be413efa5334a80ea842912b669349.txt) |
| errno | 0.3.14 | MIT OR Apache-2.0 | [LICENSE-APACHE](texts/a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2.txt), [LICENSE-MIT](texts/8764a597675778ddfd4e25f81b08a05dbcf089ac05662df7613fe67f150e3aa2.txt) |
| hash32 | 0.2.1 | MIT OR Apache-2.0 | [LICENSE-APACHE](texts/a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2.txt), [LICENSE-MIT](texts/c986bcdb83103d4ddf58aeb7b5302359782e54dc4eea14a0cc27c62dcbd50729.txt) |
| hashbrown | 0.17.1 | MIT OR Apache-2.0 | [LICENSE-APACHE](texts/a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2.txt), [LICENSE-MIT](texts/ff8f68cb076caf8cefe7a6430d4ac086ce6af2ca8ce2c4e5a2004d4552ef52a2.txt) |
| heapless | 0.7.17 | MIT OR Apache-2.0 | [LICENSE-APACHE](texts/a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2.txt), [LICENSE-MIT](texts/035e70219855119df4273b3c5b97543ae82e0dd60c520416e759107c602f651b.txt) |
| hmac-sha256 | 1.1.14 | ISC | [LICENSE](texts/6f4e2de03c87fde1f0d4481b5a6358f9d2ba1f4bf8ed331d8f2d2fc4579b4747.txt) |
| icu_collections | 2.3.0 | Unicode-3.0 | [LICENSE](texts/f367c1b8e1aa262435251e442901da4607b4650e0e63a026f5044473ecfb90f2.txt) |
| icu_locale_core | 2.4.0 | Unicode-3.0 | [LICENSE](texts/f367c1b8e1aa262435251e442901da4607b4650e0e63a026f5044473ecfb90f2.txt) |
| icu_normalizer_data | 2.3.0 | Unicode-3.0 | [LICENSE](texts/f367c1b8e1aa262435251e442901da4607b4650e0e63a026f5044473ecfb90f2.txt) |
| icu_normalizer | 2.3.0 | Unicode-3.0 | [LICENSE](texts/f367c1b8e1aa262435251e442901da4607b4650e0e63a026f5044473ecfb90f2.txt) |
| icu_properties_data | 2.3.0 | Unicode-3.0 | [LICENSE](texts/f367c1b8e1aa262435251e442901da4607b4650e0e63a026f5044473ecfb90f2.txt) |
| icu_properties | 2.3.0 | Unicode-3.0 | [LICENSE](texts/f367c1b8e1aa262435251e442901da4607b4650e0e63a026f5044473ecfb90f2.txt) |
| icu_provider | 2.4.0 | Unicode-3.0 | [LICENSE](texts/f367c1b8e1aa262435251e442901da4607b4650e0e63a026f5044473ecfb90f2.txt) |
| indexmap | 2.14.0 | Apache-2.0 OR MIT | [LICENSE-APACHE](texts/a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2.txt), [LICENSE-MIT](texts/ecc269ef87fd38a1d98e30bfac9ba964a9dbd9315c3770fed98d4d7cb5882055.txt) |
| itoa | 1.0.18 | MIT OR Apache-2.0 | [LICENSE-APACHE](texts/62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a.txt), [LICENSE-MIT](texts/23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3.txt) |
| libc | 0.2.191 | MIT OR Apache-2.0 | [LICENSE-APACHE](texts/62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a.txt), [LICENSE-MIT](texts/123a331b5dbf04c30097fa43b8f858bc85df671fe776de498d01f3d6b7c1f69e.txt) |
| linux-raw-sys | 0.12.1 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | [COPYRIGHT](texts/3290ae0fbc9ddb77d2239121d710f0bb9d31b3b4744e6d97fe01e652b4c1870b.txt), [LICENSE-APACHE](texts/a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2.txt), [LICENSE-Apache-2.0_WITH_LLVM-exception](texts/268872b9816f90fd8e85db5a28d33f8150ebb8dd016653fb39ef1f94f2686bc5.txt), [LICENSE-MIT](texts/23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3.txt) |
| litemap | 0.8.3 | Unicode-3.0 | [LICENSE](texts/f367c1b8e1aa262435251e442901da4607b4650e0e63a026f5044473ecfb90f2.txt) |
| lock_api | 0.4.14 | MIT OR Apache-2.0 | [LICENSE-APACHE](texts/a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2.txt), [LICENSE-MIT](texts/c9a75f18b9ab2927829a208fc6aa2cf4e63b8420887ba29cdb265d6619ae82d5.txt) |
| memchr | 2.8.3 | Unlicense OR MIT | [COPYING](texts/01c266bced4a434da0051174d6bee16a4c82cf634e2679b6155d40d75012390f.txt), [LICENSE-MIT](texts/0f96a83840e146e43c0ec96a22ec1f392e0680e6c1226e6f3ba87e0740af850f.txt), [UNLICENSE](texts/7e12e5df4bae12cb21581ba157ced20e1986a0508dd10d0e8a4ab9a4cf94e85c.txt) |
| miniz_oxide | 0.9.1 | MIT OR Zlib OR Apache-2.0 | [LICENSE](texts/4108245a1f2df9d4e94df8abed5b4ba0759bb2f9b40a6b939f1be141077ae50b.txt), [LICENSE-APACHE.md](texts/0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594.txt), [LICENSE-MIT.md](texts/799e9ca9d179295ef372f25d3769cdda7d25bb2668add6a6a1e22d1e4c678b8d.txt), [LICENSE-ZLIB.md](texts/0a54e647fe54104658b5e563c04c6f9edf251710e47bce692e0bd990a4ddaa39.txt) |
| num-bigint | 0.5.1 | MIT OR Apache-2.0 | [LICENSE-APACHE](texts/a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2.txt), [LICENSE-MIT](texts/6485b8ed310d3f0340bf1ad1f47645069ce4069dcc6bb46c7d5c6faf41de1fdb.txt) |
| num-integer | 0.1.47 | MIT OR Apache-2.0 | [LICENSE-APACHE](texts/a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2.txt), [LICENSE-MIT](texts/6485b8ed310d3f0340bf1ad1f47645069ce4069dcc6bb46c7d5c6faf41de1fdb.txt) |
| num-traits | 0.2.19 | MIT OR Apache-2.0 | [LICENSE-APACHE](texts/a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2.txt), [LICENSE-MIT](texts/6485b8ed310d3f0340bf1ad1f47645069ce4069dcc6bb46c7d5c6faf41de1fdb.txt) |
| postcard | 1.1.3 | MIT OR Apache-2.0 | [LICENSE-APACHE](texts/a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2.txt), [LICENSE-MIT](texts/177540cad091a40e8071db310bc3b6115c4e329a92a234609b60c154b008a888.txt) |
| potential_utf | 0.1.6 | Unicode-3.0 | [LICENSE](texts/f367c1b8e1aa262435251e442901da4607b4650e0e63a026f5044473ecfb90f2.txt) |
| proc-macro2 | 1.0.107 | MIT OR Apache-2.0 | [LICENSE-APACHE](texts/62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a.txt), [LICENSE-MIT](texts/23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3.txt) |
| quote | 1.0.47 | MIT OR Apache-2.0 | [LICENSE-APACHE](texts/62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a.txt), [LICENSE-MIT](texts/23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3.txt) |
| rayon-core | 1.13.0 | MIT OR Apache-2.0 | [LICENSE-APACHE](texts/a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2.txt), [LICENSE-MIT](texts/0621878e61f0d0fda054bcbe02df75192c28bde1ecc8289cbd86aeba2dd72720.txt) |
| rayon | 1.12.0 | MIT OR Apache-2.0 | [LICENSE-APACHE](texts/a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2.txt), [LICENSE-MIT](texts/0621878e61f0d0fda054bcbe02df75192c28bde1ecc8289cbd86aeba2dd72720.txt) |
| regex-automata | 0.4.18 | MIT OR Apache-2.0 | [LICENSE-APACHE](texts/a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2.txt), [LICENSE-MIT](texts/6485b8ed310d3f0340bf1ad1f47645069ce4069dcc6bb46c7d5c6faf41de1fdb.txt) |
| regex-syntax | 0.8.11 | MIT OR Apache-2.0 | [LICENSE-APACHE](texts/a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2.txt), [LICENSE-MIT](texts/6485b8ed310d3f0340bf1ad1f47645069ce4069dcc6bb46c7d5c6faf41de1fdb.txt) |
| regex | 1.13.1 | MIT OR Apache-2.0 | [LICENSE-APACHE](texts/a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2.txt), [LICENSE-MIT](texts/6485b8ed310d3f0340bf1ad1f47645069ce4069dcc6bb46c7d5c6faf41de1fdb.txt) |
| roxmltree | 0.21.1 | MIT OR Apache-2.0 | [LICENSE-APACHE](texts/a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2.txt), [LICENSE-MIT](texts/fffe218c1e349e1d482a05677f2ce850502f88298174d77f6ac7c04821db7899.txt) |
| rustc_version | 0.4.1 | MIT OR Apache-2.0 | [LICENSE-APACHE](texts/a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2.txt), [LICENSE-MIT](texts/c9a75f18b9ab2927829a208fc6aa2cf4e63b8420887ba29cdb265d6619ae82d5.txt) |
| rustc-hash | 2.1.3 | Apache-2.0 OR MIT | [LICENSE-APACHE](texts/95bd3988beee069fa2848f648dab43cc6e0b2add2ad6bcb17360caf749802bcc.txt), [LICENSE-MIT](texts/30fefc3a7d6a0041541858293bcbea2dde4caa4c0a5802f996a7f7e8c0085652.txt) |
| rustix | 1.1.5 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | [COPYRIGHT](texts/377c2e7c53250cc5905c0b0532d35973392af16ffb9596a41d99d202cf3617c9.txt), [LICENSE-APACHE](texts/a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2.txt), [LICENSE-Apache-2.0_WITH_LLVM-exception](texts/268872b9816f90fd8e85db5a28d33f8150ebb8dd016653fb39ef1f94f2686bc5.txt), [LICENSE-MIT](texts/23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3.txt) |
| scopeguard | 1.2.0 | MIT OR Apache-2.0 | [LICENSE-APACHE](texts/a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2.txt), [LICENSE-MIT](texts/fb77f0a9c53e473abe5103c8632ef9f0f2874d4fb3f17cb2d8c661aab9cee9d7.txt) |
| semver | 1.0.28 | MIT OR Apache-2.0 | [LICENSE-APACHE](texts/62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a.txt), [LICENSE-MIT](texts/23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3.txt) |
| serde_core | 1.0.229 | MIT OR Apache-2.0 | [LICENSE-APACHE](texts/62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a.txt), [LICENSE-MIT](texts/23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3.txt) |
| serde_derive | 1.0.229 | MIT OR Apache-2.0 | [LICENSE-APACHE](texts/62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a.txt), [LICENSE-MIT](texts/23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3.txt) |
| serde_json | 1.0.151 | MIT OR Apache-2.0 | [LICENSE-APACHE](texts/62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a.txt), [LICENSE-MIT](texts/23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3.txt) |
| serde-transcode | 1.1.1 | MIT/Apache-2.0 | [LICENSE-APACHE](texts/c6596eb7be8581c18be736c846fb9173b69eccf6ef94c5135893ec56bd92ba08.txt), [LICENSE-MIT](texts/93e6bb3f4225a1dfbc008f562d41bfac0f490f6da22c62b0a645e2c0377e8b06.txt) |
| serde | 1.0.229 | MIT OR Apache-2.0 | [LICENSE-APACHE](texts/62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a.txt), [LICENSE-MIT](texts/23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3.txt) |
| simdutf8 | 0.1.5 | MIT OR Apache-2.0 | [LICENSE-Apache](texts/0cec06e0e55fbc3dc5cee4fca9b607f66cb8f4e4dbcf3b3c013594dd156732e9.txt), [LICENSE-MIT](texts/1847e0e0698142ed4347c1441a9fa81c8fbddd44b1d8bbcd5e3647f991759d7f.txt) |
| smallvec | 1.16.4 | MIT OR Apache-2.0 | [LICENSE-APACHE](texts/a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2.txt), [LICENSE-MIT](texts/0b28172679e0009b655da42797c03fd163a3379d5cfa67ba1f1655e974a2a1a9.txt) |
| spin | 0.9.9 | MIT | [LICENSE](texts/6ac8711fb340c62ce0a4ecd463342d3fa0e8e70de697c863a2e1c0c53006003c.txt) |
| stable_deref_trait | 1.2.1 | MIT OR Apache-2.0 | [LICENSE-APACHE](texts/a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2.txt), [LICENSE-MIT](texts/5e05b024f653a5ce199e77cbbbd42fb5553562ec714b819421ed0c3e552a75d7.txt) |
| syn | 3.0.4 | MIT OR Apache-2.0 | [LICENSE-APACHE](texts/62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a.txt), [LICENSE-MIT](texts/23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3.txt) |
| synstructure | 0.14.0 | MIT | [LICENSE](texts/219920e865eee70b7dcfc948a86b099e7f4fe2de01bcca2ca9a20c0a033f2b59.txt) |
| thiserror-impl | 2.0.20 | MIT OR Apache-2.0 | [LICENSE-APACHE](texts/62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a.txt), [LICENSE-MIT](texts/23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3.txt) |
| thiserror | 2.0.20 | MIT OR Apache-2.0 | [LICENSE-APACHE](texts/62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a.txt), [LICENSE-MIT](texts/23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3.txt) |
| tinystr | 0.8.5 | Unicode-3.0 | [LICENSE](texts/f367c1b8e1aa262435251e442901da4607b4650e0e63a026f5044473ecfb90f2.txt) |
| unicode-id-start | 1.1.2 | (MIT OR Apache-2.0) AND Unicode-DFS-2016 | [LICENSE-APACHE](texts/62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a.txt), [LICENSE-MIT](texts/23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3.txt), [LICENSE-UNICODE](texts/68f5b9f5ea36881a0942ba02f558e9e1faf76cc09cb165ad801744c61b738844.txt) |
| unicode-ident | 1.0.24 | (MIT OR Apache-2.0) AND Unicode-3.0 | [LICENSE-APACHE](texts/62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a.txt), [LICENSE-MIT](texts/23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3.txt), [LICENSE-UNICODE](texts/f7db81051789b729fea528a63ec4c938fdcb93d9d61d97dc8cc2e9df6d47f2a1.txt) |
| utf8_iter | 1.0.4 | Apache-2.0 OR MIT | [COPYRIGHT](texts/c30152c94a6d75e021adbc52b3a52470366a46edb917e17deae3259251af244c.txt), [LICENSE-APACHE](texts/cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30.txt), [LICENSE-MIT](texts/3fa4ca83dcc9237839b1bdeb2e6d16bdfb5ec0c5ce42b24694d8bbf0dcbef72c.txt) |
| windows-link | 0.2.1 | MIT OR Apache-2.0 | [license-apache-2.0](texts/c16f8dcf1a368b83be78d826ea23de4079fe1b4469a0ab9ee20563f37ff3d44b.txt), [license-mit](texts/c2cfccb812fe482101a8f04597dfc5a9991a6b2748266c47ac91b6a5aae15383.txt) |
| windows-metadata | 0.100.0 | MIT OR Apache-2.0 | [license-apache-2.0](texts/c16f8dcf1a368b83be78d826ea23de4079fe1b4469a0ab9ee20563f37ff3d44b.txt), [license-mit](texts/c2cfccb812fe482101a8f04597dfc5a9991a6b2748266c47ac91b6a5aae15383.txt) |
| windows-sys | 0.61.2 | MIT OR Apache-2.0 | [license-apache-2.0](texts/c16f8dcf1a368b83be78d826ea23de4079fe1b4469a0ab9ee20563f37ff3d44b.txt), [license-mit](texts/c2cfccb812fe482101a8f04597dfc5a9991a6b2748266c47ac91b6a5aae15383.txt) |
| writeable | 0.6.4 | Unicode-3.0 | [LICENSE](texts/f367c1b8e1aa262435251e442901da4607b4650e0e63a026f5044473ecfb90f2.txt) |
| xxhash-rust | 0.8.18 | BSL-1.0 | [LICENSE](texts/c9bff75738922193e67fa726fa225535870d2aa1059f91452c411736284ad566.txt) |
| yoke-derive | 0.8.4 | Unicode-3.0 | [LICENSE](texts/f367c1b8e1aa262435251e442901da4607b4650e0e63a026f5044473ecfb90f2.txt) |
| yoke | 0.8.4 | Unicode-3.0 | [LICENSE](texts/f367c1b8e1aa262435251e442901da4607b4650e0e63a026f5044473ecfb90f2.txt) |
| zerofrom-derive | 0.1.8 | Unicode-3.0 | [LICENSE](texts/f367c1b8e1aa262435251e442901da4607b4650e0e63a026f5044473ecfb90f2.txt) |
| zerofrom | 0.1.8 | Unicode-3.0 | [LICENSE](texts/f367c1b8e1aa262435251e442901da4607b4650e0e63a026f5044473ecfb90f2.txt) |
| zerotrie | 0.2.5 | Unicode-3.0 | [LICENSE](texts/f367c1b8e1aa262435251e442901da4607b4650e0e63a026f5044473ecfb90f2.txt) |
| zerovec-derive | 0.11.7 | Unicode-3.0 | [LICENSE](texts/f367c1b8e1aa262435251e442901da4607b4650e0e63a026f5044473ecfb90f2.txt) |
| zerovec | 0.11.9 | Unicode-3.0 | [LICENSE](texts/f367c1b8e1aa262435251e442901da4607b4650e0e63a026f5044473ecfb90f2.txt) |
| zmij | 1.0.23 | MIT | [LICENSE-MIT](texts/23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3.txt) |
