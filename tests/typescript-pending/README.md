# TypeScript families awaiting enrollment

These cases use the same format as `tests/typescript/`: test262 front matter
and self-checking assertions through the harness. The runner does not select
this directory. Their oracle is TypeScript's own emit, run by Node, as for the
selected suite. Each family waits for enrollment with its required compiler
options and fixture layout; moving it into the suite is separate work.

| family | enrollment requirements |
| --- | --- |
| `decorators/` | standard decorator emit, without `experimentalDecorators` |
| `legacy-decorators/` | `experimentalDecorators` |
| `accessor-fields/` | accessor field emit under the pinned runtime target |
| `transform-divergence/` | whole-program emit with `isolatedModules` off |
| `modules/` | fixture modules beside each caller |
| `commonjs-interop/` | a CommonJS project and companion modules |
| `jsx/` | a TSX project with the required JSX emit options |

Each family's README describes its inputs. The oracle contract is in
[TypeScript conformance](../../docs/conformance/typescript.md#the-oracle).
