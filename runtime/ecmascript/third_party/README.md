# Provenance

The regexp parser and explicit-stack execution design were developed with
[QuickJS-ng libregexp.c at the existing pin](https://github.com/quickjs-ng/quickjs/blob/776150276b3657b90b0719755d5e111fa56a1a6d/libregexp.c)
as a reference. The TypeScript grammar tree and instruction layout are owned by
NTS; they do not implement QuickJS's bytecode ABI or embed its JS interpreter.

Unicode data is derived from the files already vendored at
`runtime/c/quickjs`, revision
`776150276b3657b90b0719755d5e111fa56a1a6d`. The generated file records the hashes
of those inputs. Updating that revision requires reviewing and regenerating the
regexp data together.

`QUICKJS-LICENSE` copies the vendored MIT notice. `UNICODE-LICENSE` copies the
Unicode License V3 notice from `libunicode-table.h`.

Intl preference metadata derives from
[CLDR 48.2 supplementalData.xml](https://raw.githubusercontent.com/unicode-org/cldr/release-48-2/common/supplemental/supplementalData.xml),
SHA-256 `cd2af39aef82fdbfba4d591c87548203350538ad2318486d104b3b38b8d62f1a`.
The source and Unicode license hashes are pinned in `providers/icu/artifacts.json`;
`tools/generate-locale-preferences.ts` verifies both. The generated module retains
the Unicode copyright/SPDX notice and references `UNICODE-LICENSE`. Only explicit
calendar/week availability and ordered hour-cycle metadata absent from public
ICU queries are retained. Calendar/week values, names and time-zone data remain
in the pinned ICU providers.

Chinese and Korean calendar year data derives from
[ICU4X at fe2b931521a2c3e90846908faeb4fd8ee22efecb](https://github.com/unicode-org/icu4x/tree/fe2b931521a2c3e90846908faeb4fd8ee22efecb/components/calendar/src/cal/east_asian_traditional).
`lunisolar-sources.json` pins all three source hashes and the full license notice
in `ICU4X-LICENSE`. `tools/generate-lunisolar-data.ts` validates continuity,
month lengths and encoding before emitting the shared packed tables. The
common 1899 boundary row comes from the pinned public ICU 78.3 calendar fields;
it preserves January 1900 dates before that year's New Year. The tables cover
Chinese years 1900–2100 and Korean years 1900–2050, with a next-year row for
boundary validation. Only year data is included; no ICU4X engine or dependency
is linked into applications.
