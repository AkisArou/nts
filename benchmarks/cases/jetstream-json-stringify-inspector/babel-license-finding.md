# Babel WTB: transitive licence finding

The unchanged `babel-wtb` program cannot be submitted under the current list of
permitted licences. Its pinned Babel standalone bundle contains
`caniuse-lite@1.0.30001731`, whose exact release declares `CC-BY-4.0` and includes
the Attribution 4.0 International licence. The user's permitted list is MIT,
BSD, Apache, zlib, Boost, ISC and Unicode. This finding concerns three source
modules as well as three data modules.

## Provenance

- JetStream revision: `3967678fa8ab98d847ab33cf3728dba726fa854b`.
- JetStream file: `web-tooling-benchmark/dist/babel.bundle.js`.
- Bundled compiler: `@babel/standalone@7.28.3`.
- Babel source revision: `ef155f5ca83c73dbc1ea8d95216830b7dc3b0ac2` (`v7.28.3`).
- That revision's `yarn.lock` resolves `caniuse-lite` to `1.0.30001731`.
- Exact package: <https://registry.npmjs.org/caniuse-lite/-/caniuse-lite-1.0.30001731.tgz>.
- Tarball SHA-256: `97a4465d9119c089234d37c05e10a050b97d4a65d2f815da8cebfbbd8f245f26`.
- Package `package.json`: `"license": "CC-BY-4.0"`.
- Package `LICENSE`: `Attribution 4.0 International`.
- Exact npm metadata `gitHead`:
  `fad79027ebb5bfe5cce1d34ac5e52b6fbc5e780b`.
- [Exact source licence](https://github.com/browserslist/caniuse-lite/blob/fad79027ebb5bfe5cce1d34ac5e52b6fbc5e780b/LICENSE):
  byte-identical to the npm licence; SHA-256
  `fd3a263fe19ed8faa9068b43abaebafc02c77897b0c6fc09abc04bb592e5f16e`.
- [Exact source README](https://github.com/browserslist/caniuse-lite/blob/fad79027ebb5bfe5cce1d34ac5e52b6fbc5e780b/README.md)
  expressly applies CC BY 4.0 to the data and requests attribution to caniuse.com.

The complete source tree at that commit contains one licence file, `LICENSE`,
and no additional licence, COPYING or NOTICE file. None of the six exact files
has a separate licence header. Their Git blob hashes also match the exact
upstream commit. No separate permitted or dual-licence grant was found in the
release metadata, package licence, exact source licence/README, complete source
tree or those file headers. The classification is the package's declared
CC-BY-4.0 licence, expressly confirmed for the data by its README; no contrary
per-file grant was found for the accompanying unpacker code.

The six files below are byte-for-byte matches between that release tarball and
the `sourcesContent` in Babel 7.28.3's source map. The source map's full release
body was already matched to the pinned JetStream module after its five
documented bundler substitutions. The caniuse modules are untouched by those
substitutions.

| Package path | Bytes | SHA-256 |
|---|---:|---|
| `data/browsers.js` | 220 | `63c5f20e38bbeef5d28f0af686170bb9ee1438819c96583a6af621c4b1ec0edf` |
| `dist/unpacker/browsers.js` | 57 | `b8775f01de6ff801a56db3478b5e3794debf222a7d73239f20d37589f9cc968b` |
| `data/browserVersions.js` | 2,230 | `d4632a391920f111a6d8b48c0de230de3fe96b34dabfb42242222b01c613b8e8` |
| `dist/unpacker/browserVersions.js` | 71 | `21fb3fc52b70bb44091d82e55f74f8e93ffe6ab5608654af64da7964b4acc455` |
| `data/agents.js` | 23,470 | `f356e12e37630c96b44bcc8a4fbea3fb8c01b79eaa272753da49ad05f21931c3` |
| `dist/unpacker/agents.js` | 1,439 | `6c62eb14bb8653e3a80fb0aea9d38462f68b0711346a3fd92eee7e9edff069fe` |

The emitted unpacker is visible directly in the JetStream bundle as
`unpackBrowserVersions` and `agents$2.agents = Object.keys(agentsData).reduce(...)`,
following the embedded browser and agent tables. It runs during module
initialization. JetStream's adjacent `dist/babel.LICENSE.txt` lists
`@babel/standalone`, Babylon and text-encoder, and does not list caniuse-lite.

## What remains preserved locally

No Babel port commit or PR has been created. Its full source, full input, class
transcription and completed subsystem audits remain in the local Babel
worktree. The complete strict check is still unfinished; this is not a ready
port awaiting only a licence decision.

The prototype/descriptor decision was implemented without deleting the
operations. An instrumented comparison already confirms that measured
operations match the untouched bundle exactly:

| Operation | First full operation | Repeated full operation |
|---|---:|---:|
| `Object.defineProperty` | 1,266 | 883 |
| `Object.getOwnPropertyDescriptor` | 126 | 17 |
| `Object.setPrototypeOf` | 315 | 32 |
| `Object.create` | 3,793 | 3,253 |
| `Object.freeze` | 56 | 3 |

Gensync's subset remains 126 metadata read/write pairs in the first operation
(124 `length`, two `name`) and 17 in the repeated operation (16 `length`, one
`name`). The full Redux transformation remains 21,248 characters, SHA-256
`968ca8f97a50a133c71a65e448957769cfa466d3df630411795220c2392a03bc`; the adapter
returns `1659337555` for `work(1)` and `251647654` for `work(2)`.

Removing, replacing or trimming the caniuse modules would conflict with the
unchanged full-program transcription instruction. The inventory should record
the licence finding and await the maintainers' decision.
