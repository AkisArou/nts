# TypeScript-lib source and notice review

This row preserves the full compiler and all 118 input files. The inputs are
source text consumed by the compiler; none is evaluated as JavaScript. This
review records the licence grants and notices for those exact files. It does
not treat the bundled `dist/LICENSE.txt` as a replacement for TypeScript's
third-party notices.

## Copied material

| Material | Pinned source | Licence used |
| --- | --- | --- |
| Benchmark, compilation driver and browser mock host | [`WebKit/JetStream@3967678fa8ab98d847ab33cf3728dba726fa854b/TypeScript`](https://github.com/WebKit/JetStream/tree/3967678fa8ab98d847ab33cf3728dba726fa854b/TypeScript) | The files' BSD-2-Clause notices, including Apple and Google attribution in `src/test.mjs`. |
| TypeScript compiler | [`microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9`](https://github.com/microsoft/TypeScript/tree/5be33469d551655d878876faa9e30aa3b49f8ee9), the `v5.9.2` source | Apache-2.0; every modified source module identifies its origin and modifications. |
| 102 Microsoft declaration files | Unchanged strings in the pinned [`files.json`](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/TypeScript/src/gen/immer-tiny/files.json) | Each original Apache-2.0 header remains inside the input string; applicable third-party notices also remain. |
| 16 Immer source files | The same `files.json`, matching [`immerjs/immer@19cbe47ae3db3b4a8940409ab1814ce1a9af3458`](https://github.com/immerjs/immer/tree/19cbe47ae3db3b4a8940409ab1814ce1a9af3458) | MIT, with the complete upstream notice. |

The JetStream lockfile resolves TypeScript **5.9.2**. Its
[`dist/LICENSE.txt`](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/TypeScript/dist/LICENSE.txt)
and Microsoft's
[`LICENSE.txt`](https://github.com/microsoft/TypeScript/blob/5be33469d551655d878876faa9e30aa3b49f8ee9/LICENSE.txt)
provide the Apache-2.0 grant. The authored source archive was pinned separately;
all 276 original source modules used by this port match that archive byte for
byte before the documented transcription changes.

## Complete third-party notices

Microsoft's
[`ThirdPartyNoticeText.txt`](https://github.com/microsoft/TypeScript/blob/5be33469d551655d878876faa9e30aa3b49f8ee9/ThirdPartyNoticeText.txt)
is preserved byte for byte as `TypeScript-ThirdPartyNoticeText.txt`, and its
complete text is appended to `../LICENSE-jetstream`. It includes DefinitelyTyped
(MIT), Unicode data/software, W3C DOM, WHATWG DOM, Background Synchronization and
WebGL (the Khronos permissive notice). Keeping the full file avoids discarding a
notice merely because its component is dormant or present only in input text.

### WHATWG DOM: source-code BSD-3-Clause option

The copied TypeScript notice contains the historical 2018 WHATWG CC-BY-4.0
notice. The current [WHATWG IPR Policy, section 7.1.1](https://whatwg.org/ipr-policy#7.1.1.)
and the [DOM Standard's intellectual property section](https://dom.spec.whatwg.org/#ipr)
offer **BSD-3-Clause for portions incorporated into source code**. This port
selects that source-code grant for the WHATWG material in the declaration inputs.
The complete WHATWG BSD-3-Clause notice is included in `../LICENSE-jetstream`.
The received historical CC-BY notice is also retained in the original notice
file; it is not the selected licence for the source-code portions.

The date of this option was checked rather than inferred from the 2018 copyright
year. It was introduced on **2021-03-23**, in
[`whatwg/sg@bf1fed7746c70c66b75e29bcff22dca52e48994f`](https://github.com/whatwg/sg/commit/bf1fed7746c70c66b75e29bcff22dca52e48994f).
It is present in the
[2022-07-20 policy revision](https://github.com/whatwg/sg/blob/2d57438b5d4f48bd23801892f711ec49e33f8e5f/IPR%20Policy.md),
which precedes TypeScript 5.9.2. The 2018 policy did not contain this option.

### W3C DOM and Background Synchronization

The complete [W3C Software and Document License, 2015 version](https://www.w3.org/copyright/software-license-2015/)
received with TypeScript permits copying, modification and distribution for any
purpose, with the full notice, pre-existing notices, modification attribution
and its disclaimers retained. W3C's own
[intellectual-rights FAQ](https://www.w3.org/copyright/intellectual-rights/)
expressly permits incorporating its code into other non-copyleft or proprietary
licences while complying with those notice conditions. Microsoft's Apache
headers on the derivative declaration files do not remove these conditions.
This port retains the complete W3C terms and attribution in the shared notice.
The declaration input text itself is unchanged.

The copied Background Synchronization notice includes the W3C Community Final
Specification Agreement. Its copyright grant explicitly includes derivative
works, sublicensing, distribution and implementation, subject to specification
attribution; the complete agreement is retained. The specification repository's
[`LICENSE.md` at its 2015-12-09 introduction](https://github.com/WICG/background-sync/blob/8a604a827effdd9400628fdac8c83c796dc6b815/LICENSE.md)
also licenses its reports under the W3C Software and Document License. The
repository has a separate Apache-2.0 `LICENSE`; this review does not use that
file alone to erase the report's W3C terms. The shared notice identifies
**Web Background Synchronization, Level 1** and its
[original provider](https://wicg.github.io/background-sync/spec/).

The selected code grants are the original Apache-2.0, BSD and MIT grants,
with the permissive Unicode and third-party notice obligations above preserved.
No input is truncated, relicensed by removing its notices, or replaced to obtain
a different licence result.
