# Shared-effect prepared-HIR review for #1049

This lists every changed function in valid before/effect-only capture pairs after connecting the shared runtime storage contract to slot effects, with entry versioning disabled. The effect-only compiler predates the confined-fresh-writer refinement. Hashes identify the complete project/provider listing and each function diff. Raw evidence is under `~/.cache/nts-scratch/1049/corpora/`.

The 77 reviewed rows come from `reviewed-effects.jsonl`, SHA-256 `6194a828d305171e996cf0a0c63f0d8f701180dd6f30fd78d2ce3b61fc3fe96c`. The [main record](null-slot-entries-1049.md) describes population, exclusions and the native controls.

## benchmarks/cases/ares6-air (rc)

`FrequentedBlock#toString`: The live FrequentedBlock receiver owns block throughout BasicBlock.toString. That method only reads _index and appends its number to an independent prefix; it cannot replace block or invoke a callback. The field receiver retain/release pair is redundant.

Before HIR `43f1ef8e07f5cc4a6b49a88adbd887da0730dea08d363cc5028b0834d18a02a2`; effect-only HIR `1580bb8f7c41c78ebdb48e1d9af537db35b0cbc945b87462073fd7452c4e7795`. Diff `6c43bc61729e43ddead7f47d.diff`, SHA-256 `4b290f7b36f3741772fc23b739d4cb883a684b16b3cc3a9899d60ee813f4f55b`.

## benchmarks/cases/jetstream-raytrace-private-class-fields (rc)

`IntersectionInfo#toString`: The caller-held receiver owns its Color or Vector fields throughout formatting. Color.toString and Vector.toString only read numeric components and append independent strings; they cannot replace the holder fields or invoke program callbacks. Their field receiver borrows remain valid, removing one retain/release pair per field (two in Ray).

Before HIR `f58f136fa07d662cf024f23d3a451de411a32fd82cd8e7d5d6b624527c19ed9f`; effect-only HIR `b4a56d9f433649d0489bfb16f6da2a8c659d9917864f5392026d68f83d08e255`. Diff `5c3562f94b2457a5c7a7e987.diff`, SHA-256 `76b7fb54a3f751080b990079e475c14077519ed051e229fe0675b5129e01c7a6`.

## benchmarks/cases/jetstream-raytrace-public-class-fields (rc)

`Background#toString`: The caller-held receiver owns its Color or Vector fields throughout formatting. Color.toString and Vector.toString only read numeric components and append independent strings; they cannot replace the holder fields or invoke program callbacks. Their field receiver borrows remain valid, removing one retain/release pair per field (two in Ray).

Before HIR `926401aba43643207712ac9679ed93e7457fb691b38f76827c933526a9683dec`; effect-only HIR `8196898b3b912250c3734762c561e4de2b2ae9740164b59e47a467ae6d26c159`. Diff `c58faedcf52b79f090e41262.diff`, SHA-256 `ce01798aa49ab9b75fc1787ae5b9295115aed0f0c22576169c86c1b2379bedcf`.

`Background#toString@raises`: The caller-held receiver owns its Color or Vector fields throughout formatting. Color.toString and Vector.toString only read numeric components and append independent strings; they cannot replace the holder fields or invoke program callbacks. Their field receiver borrows remain valid, removing one retain/release pair per field (two in Ray).

Before HIR `926401aba43643207712ac9679ed93e7457fb691b38f76827c933526a9683dec`; effect-only HIR `8196898b3b912250c3734762c561e4de2b2ae9740164b59e47a467ae6d26c159`. Diff `7614e4d131679460c4f3d3f6.diff`, SHA-256 `7171143afb5eac75b0cf22110966d915a663f140b2b3a79050dde70906a4163f`.

`Camera#toString`: The caller-held receiver owns its Color or Vector fields throughout formatting. Color.toString and Vector.toString only read numeric components and append independent strings; they cannot replace the holder fields or invoke program callbacks. Their field receiver borrows remain valid, removing one retain/release pair per field (two in Ray).

Before HIR `926401aba43643207712ac9679ed93e7457fb691b38f76827c933526a9683dec`; effect-only HIR `8196898b3b912250c3734762c561e4de2b2ae9740164b59e47a467ae6d26c159`. Diff `f39fb9407cc259232bc91a7b.diff`, SHA-256 `ec5e80bffeafca260d7485861c5d7f2d7e43bc15c19c2e1e7da8b2cb23f36658`.

`IntersectionInfo#toString`: The caller-held receiver owns its Color or Vector fields throughout formatting. Color.toString and Vector.toString only read numeric components and append independent strings; they cannot replace the holder fields or invoke program callbacks. Their field receiver borrows remain valid, removing one retain/release pair per field (two in Ray).

Before HIR `926401aba43643207712ac9679ed93e7457fb691b38f76827c933526a9683dec`; effect-only HIR `8196898b3b912250c3734762c561e4de2b2ae9740164b59e47a467ae6d26c159`. Diff `d8ced9dd6d0c9408a84e4c53.diff`, SHA-256 `76b7fb54a3f751080b990079e475c14077519ed051e229fe0675b5129e01c7a6`.

`Light#toString`: The caller-held receiver owns its Color or Vector fields throughout formatting. Color.toString and Vector.toString only read numeric components and append independent strings; they cannot replace the holder fields or invoke program callbacks. Their field receiver borrows remain valid, removing one retain/release pair per field (two in Ray).

Before HIR `926401aba43643207712ac9679ed93e7457fb691b38f76827c933526a9683dec`; effect-only HIR `8196898b3b912250c3734762c561e4de2b2ae9740164b59e47a467ae6d26c159`. Diff `d28da6390dbdc498397eaee1.diff`, SHA-256 `3c89f7e806676e354a75663b15b1d360bbee89e30270cc9cbe93f2231b81e6ac`.

`Plane#toString`: The caller-held receiver owns its Color or Vector fields throughout formatting. Color.toString and Vector.toString only read numeric components and append independent strings; they cannot replace the holder fields or invoke program callbacks. Their field receiver borrows remain valid, removing one retain/release pair per field (two in Ray).

Before HIR `926401aba43643207712ac9679ed93e7457fb691b38f76827c933526a9683dec`; effect-only HIR `8196898b3b912250c3734762c561e4de2b2ae9740164b59e47a467ae6d26c159`. Diff `349eff2c271bfa28146c97da.diff`, SHA-256 `0bfe6051b923a32eba4a8f77ca89fe6d46aa287fbd24d1c3bcc357b64f9e6c0a`.

`Ray#toString`: The caller-held receiver owns its Color or Vector fields throughout formatting. Color.toString and Vector.toString only read numeric components and append independent strings; they cannot replace the holder fields or invoke program callbacks. Their field receiver borrows remain valid, removing one retain/release pair per field (two in Ray).

Before HIR `926401aba43643207712ac9679ed93e7457fb691b38f76827c933526a9683dec`; effect-only HIR `8196898b3b912250c3734762c561e4de2b2ae9740164b59e47a467ae6d26c159`. Diff `a9791ab5841a16938e0c49d2.diff`, SHA-256 `58d2567cb4f10a15e8ee12619f19b954285a3193fb407c655ebcffd2d2f5998d`.

`Sphere#toString`: The caller-held receiver owns its Color or Vector fields throughout formatting. Color.toString and Vector.toString only read numeric components and append independent strings; they cannot replace the holder fields or invoke program callbacks. Their field receiver borrows remain valid, removing one retain/release pair per field (two in Ray).

Before HIR `926401aba43643207712ac9679ed93e7457fb691b38f76827c933526a9683dec`; effect-only HIR `8196898b3b912250c3734762c561e4de2b2ae9740164b59e47a467ae6d26c159`. Diff `3cfacb0e3b43246f19fcd609.diff`, SHA-256 `42eef0cb3865facb85c30137b7fca86ca599aa55ab44e0034c2892c50f851b27`.

## benchmarks/cases/str-equal (rc)

`copies`: The caller-held from array owns word throughout the unit-by-unit copy. The append_char_code consumes only the independent copy accumulator, cannot mutate from, and invokes no program code. Removing word retain/release also removes its empty cleanup block.

Before HIR `643a080945d8f30e8995c0cfca5b4f17d84252c36224ec814cd8ee58de6a7be1`; effect-only HIR `818e356f69bc9e2d3d5b902c1c6f9b0303ac99e4ec084f23281933a72526d913`. Diff `fb483f3b4d9ed09660946d9e.diff`, SHA-256 `8f5423f2158f79d155f786b91d576db5d5f99f183dd989e59172533450484688`.

## compiler/core/tests/programs/accessor-families/tsconfig.json (rc)

`readonlyGetter`: The mapped value remains owned by the live source array; labelOf dispatches only to a field read or a getter whose number append cannot write program storage. The temporary element retain/release pair is unnecessary.

Before HIR `1466dd5d57bbb5bb51b5cee1bac47826a1d86a69e56a32291d8e5d5cde479c7b`; effect-only HIR `12d3ca1181effcc348f739964b74499f936a9e80646b9655f659d7dfb8516824`. Diff `45d8fed98dd794e45046f0c9.diff`, SHA-256 `1723ad622cf970e18603e9ffd43b05ae8197b7d286c8b58e88c9cf22a86a79e6`.

`readonlyGetter#whole`: The source array owns each borrowed element through labelOf; its getter append cannot mutate that owner. Removing the temporary pair also coalesces the final array release edge into the loop exit, before join uses only the result array.

Before HIR `1466dd5d57bbb5bb51b5cee1bac47826a1d86a69e56a32291d8e5d5cde479c7b`; effect-only HIR `12d3ca1181effcc348f739964b74499f936a9e80646b9655f659d7dfb8516824`. Diff `16f49526ee1c96caf690fa11.diff`, SHA-256 `540464b484f7861f26e4f33d6c2444177d831f6d39c56d310d119d2a25121532`.

## compiler/core/tests/programs/interface-field-view-lifetime/tsconfig.json (rc)

`namesFromFrameArray`: The live all array owns each borrowed Named element; readName reaches a field or a numeric getter append which cannot invalidate the array element. Remove the temporary pair.

Before HIR `a33dd0eec9caf5325a25ee222d5db2063a4b04f51f06c7749215966a4ea2a846`; effect-only HIR `1ee18fb3d1eb63e0d84b6abc3d37b30fd540f92acb39f7a8b85a99378de5e013`. Diff `013dbc87e929d2e83feecc74.diff`, SHA-256 `c0acabe9aa9053afc0b811d6223ed12014de9bd7c96f94f1da574214d1d46439`.

`namesFromFrameArray#whole`: The live all array owns the borrowed elements through readName. Its final release moves from a split edge into the exit after the last element read; join uses the separate mapped array.

Before HIR `a33dd0eec9caf5325a25ee222d5db2063a4b04f51f06c7749215966a4ea2a846`; effect-only HIR `1ee18fb3d1eb63e0d84b6abc3d37b30fd540f92acb39f7a8b85a99378de5e013`. Diff `48676064f84590c02e88b5ee.diff`, SHA-256 `74150fb1a984134bff24abb6452ca3ba62b640693ca0b140529a3a626baf1075`.

`survivesOwnerRelease`: The field getter now remains a borrow across its independent append. The release uses the retained erased owner instead of its unerased view; both identify the same owned object and the release remains after the getter.

Before HIR `a33dd0eec9caf5325a25ee222d5db2063a4b04f51f06c7749215966a4ea2a846`; effect-only HIR `1ee18fb3d1eb63e0d84b6abc3d37b30fd540f92acb39f7a8b85a99378de5e013`. Diff `a41f1f27aed52d93c74fc82d.diff`, SHA-256 `3cc486e2c41ccf81ca8a619f4895bc4410d0752f63625626cb8d22f29c255621`.

`survivesOwnerRelease#whole`: The getter borrow remains valid across the independent append. Releasing the retained erased owner after the getter is equivalent to releasing its unerased view of the same object; operation counts are unchanged.

Before HIR `a33dd0eec9caf5325a25ee222d5db2063a4b04f51f06c7749215966a4ea2a846`; effect-only HIR `1ee18fb3d1eb63e0d84b6abc3d37b30fd540f92acb39f7a8b85a99378de5e013`. Diff `b1ccd50c27a3924d92b4b167.diff`, SHA-256 `a674977f14efd9ea58939ff5e4b0192f2ec766969670f12a7d6157796803d7a3`.

## compiler/core/tests/programs/prefix-receivers/tsconfig.json (rc)

`read@0obj12`: The receiver owns the borrowed string field. With the shared helper storage contract, ownership selects the non-consuming concat_number instead of retain plus consuming append_number, preserving the field alias without the extra retain.

Before HIR `9fdd0829d67bcfe90ced960a5d384b576117f25596679a2f299f1b70823a0948`; effect-only HIR `2f1ef29d0e59c680db906a1d4b084a5445d455a003a189f58b70a1ac794050a0`. Diff `dff8ec4db56af5a1df440a9c.diff`, SHA-256 `daf5d8a2892eb238ca8f474375787130b821b1b479332aef423c67c079890a58`.

`read@0obj18`: The receiver owns the borrowed string field. With the shared helper storage contract, ownership selects the non-consuming concat_number instead of retain plus consuming append_number, preserving the field alias without the extra retain.

Before HIR `9fdd0829d67bcfe90ced960a5d384b576117f25596679a2f299f1b70823a0948`; effect-only HIR `2f1ef29d0e59c680db906a1d4b084a5445d455a003a189f58b70a1ac794050a0`. Diff `c009588d59ad9e7b0d8fb98d.diff`, SHA-256 `233b5ef6d32b29d1c140cdac6ab68cd923b7de385e652217af8bd61b96fc9223`.

`read@0obj5`: The receiver owns the borrowed string field. With the shared helper storage contract, ownership selects the non-consuming concat_number instead of retain plus consuming append_number, preserving the field alias without the extra retain.

Before HIR `9fdd0829d67bcfe90ced960a5d384b576117f25596679a2f299f1b70823a0948`; effect-only HIR `2f1ef29d0e59c680db906a1d4b084a5445d455a003a189f58b70a1ac794050a0`. Diff `11b4ab3cb7a7b4d57e1a2716.diff`, SHA-256 `5f19e3891b605b5085457f3f8af69286aa6d0e60d45c9d3b8433576c16716d0a`.

## runtime/node/child_process/tsconfig.json (rc)

`URL#get host`: The live URL receiver owns its record throughout serializeHost, which reads only host and port and constructs a string. Its numeric append cannot mutate that record or invoke program code, so the temporary record retain/release pair is unnecessary.

Before HIR `f4877850f97730abbfd3a78e1b1157a29dac6eab7824a7e80558b84c16449b77`; effect-only HIR `ef84bded41fcb17ab4df9d18e3d535b865158c41d065e3f33e782fe8f08d7006`. Diff `8fb7654d0bddfd878a541182.diff`, SHA-256 `a9aa15b41bbd2b88b0b319c8b91ccb47c9b8e0d913e2105de268c6a34abac513`.

`URL#get host@raises`: The live URL receiver owns its record throughout serializeHost, which reads only host and port and constructs a string. Its numeric append cannot mutate that record or invoke program code, so the temporary record retain/release pair is unnecessary.

Before HIR `f4877850f97730abbfd3a78e1b1157a29dac6eab7824a7e80558b84c16449b77`; effect-only HIR `ef84bded41fcb17ab4df9d18e3d535b865158c41d065e3f33e782fe8f08d7006`. Diff `50f05891257c971d82d13372.diff`, SHA-256 `b03756914180675bd822ce8bd9cbb5673a7fd9d6f78987c92448d21002cfdd8c`.

## runtime/node/cluster/tsconfig.json (rc)

`URL#get host`: The live URL receiver owns its record throughout serializeHost, which reads only host and port and constructs a string. Its numeric append cannot mutate that record or invoke program code, so the temporary record retain/release pair is unnecessary.

Before HIR `c342c6e8415e376eae1acb263f601c1f121b930d7561acdcf83f05ac1f3b8d47`; effect-only HIR `842b321e5cace988c114c370d3e031979d137a21fec244ef1e81650c4a944861`. Diff `4752e47938eb2f96838d064b.diff`, SHA-256 `bd7448c37f1b619dde7a798b3ab09123d38016acb55d422b1e1f42f8324502a5`.

`URL#get host@raises`: The live URL receiver owns its record throughout serializeHost, which reads only host and port and constructs a string. Its numeric append cannot mutate that record or invoke program code, so the temporary record retain/release pair is unnecessary.

Before HIR `c342c6e8415e376eae1acb263f601c1f121b930d7561acdcf83f05ac1f3b8d47`; effect-only HIR `842b321e5cace988c114c370d3e031979d137a21fec244ef1e81650c4a944861`. Diff `d91d5aed734ad41bdab05699.diff`, SHA-256 `99d8b7c6e77bee02103a1c5335421d640defb659ddbeaa37c9b5b05fa982e54c`.

## runtime/node/dgram/tsconfig.json (rc)

`URL#get host`: The live URL receiver owns its record throughout serializeHost, which reads only host and port and constructs a string. Its numeric append cannot mutate that record or invoke program code, so the temporary record retain/release pair is unnecessary.

Before HIR `79cb36b8e6df22f53dfdddd216a2efa8edd890a3acfa9a782fd55f657c3a966c`; effect-only HIR `0eeaaa649c438d0f4cb4c45e3f99004124c2ad0b0f7223c3e39c128e250a8822`. Diff `911020a77874e7af20de1250.diff`, SHA-256 `5607235637c55dfe1015e98fd64e3dacb14b2b8aa1349eea6213a27c2263ae05`.

`URL#get host@raises`: The live URL receiver owns its record throughout serializeHost, which reads only host and port and constructs a string. Its numeric append cannot mutate that record or invoke program code, so the temporary record retain/release pair is unnecessary.

Before HIR `79cb36b8e6df22f53dfdddd216a2efa8edd890a3acfa9a782fd55f657c3a966c`; effect-only HIR `0eeaaa649c438d0f4cb4c45e3f99004124c2ad0b0f7223c3e39c128e250a8822`. Diff `17d666f6e47d0ca3460b0ec4.diff`, SHA-256 `625a4b1d998ba05de1cf966246ebf8cbf8d483e2554e8d109104a1a936f52d70`.

## runtime/node/fs/tsconfig.json (rc)

`URL#get host`: The live URL receiver owns its record throughout serializeHost, which reads only host and port and constructs a string. Its numeric append cannot mutate that record or invoke program code, so the temporary record retain/release pair is unnecessary.

Before HIR `5f8c1fa9ab8497d91c1901d1121148aa5e04580fa627f1595df4362836fce8a2`; effect-only HIR `d9ca9268182cccfd2a3530279eba8dcf93071bfa8d2baa50ab9686ca92785463`. Diff `4aa53b293da6060fc32bc519.diff`, SHA-256 `4fc903ef1e35ad0ffcdde88e66fb80668f778d139bed29464ce0884ad9ac6704`.

`URL#get host@raises`: The live URL receiver owns its record throughout serializeHost, which reads only host and port and constructs a string. Its numeric append cannot mutate that record or invoke program code, so the temporary record retain/release pair is unnecessary.

Before HIR `5f8c1fa9ab8497d91c1901d1121148aa5e04580fa627f1595df4362836fce8a2`; effect-only HIR `d9ca9268182cccfd2a3530279eba8dcf93071bfa8d2baa50ab9686ca92785463`. Diff `0033388a383505bba9c58bd6.diff`, SHA-256 `b60f6a3279e7d153773a2f4fa96b581e218ec825a6715da22e80a9fbee49bdda`.

## runtime/node/http/tsconfig.json (rc)

`URL#get host`: The live URL receiver owns its record throughout serializeHost, which reads only host and port and constructs a string. Its numeric append cannot mutate that record or invoke program code, so the temporary record retain/release pair is unnecessary.

Before HIR `c3abcdcbe00734f8c9d7ad808399becb0e57fa23c41049cba3ac2dbcd4499e69`; effect-only HIR `2f9f1b38d5a76f722cb226abbd04580b2a1f10f05c096d58adbc37b8660eecf0`. Diff `1c3c9f2828e6b7cf65fb7d17.diff`, SHA-256 `9b68326ed08fac5374a362c4bdfc1f8de0f21b8f519ceb468b5f329cecb69129`.

`URL#get host@raises`: The live URL receiver owns its record throughout serializeHost, which reads only host and port and constructs a string. Its numeric append cannot mutate that record or invoke program code, so the temporary record retain/release pair is unnecessary.

Before HIR `c3abcdcbe00734f8c9d7ad808399becb0e57fa23c41049cba3ac2dbcd4499e69`; effect-only HIR `2f9f1b38d5a76f722cb226abbd04580b2a1f10f05c096d58adbc37b8660eecf0`. Diff `ea2ee541f94b5e23786f9b9a.diff`, SHA-256 `47dd3d48a1491d2c58ca81c5771cf983d8241a81f3557a41f62e97a60cef131d`.

## runtime/node/net/tsconfig.json (rc)

`URL#get host`: The live URL receiver owns its record throughout serializeHost, which reads only host and port and constructs a string. Its numeric append cannot mutate that record or invoke program code, so the temporary record retain/release pair is unnecessary.

Before HIR `d889f3704f8951ed2dd55c297c88c2b41861b82692a757827c9f2b6a8bfe1b81`; effect-only HIR `192211dfc858c21dbd8746c31463539105e8e25662983042c0d57ab2279e8a08`. Diff `c4906fa2611d958e405e127d.diff`, SHA-256 `895427fc82744892558dc13a326502ade9f09d84dd53b981ff073bb68a877285`.

`URL#get host@raises`: The live URL receiver owns its record throughout serializeHost, which reads only host and port and constructs a string. Its numeric append cannot mutate that record or invoke program code, so the temporary record retain/release pair is unnecessary.

Before HIR `d889f3704f8951ed2dd55c297c88c2b41861b82692a757827c9f2b6a8bfe1b81`; effect-only HIR `192211dfc858c21dbd8746c31463539105e8e25662983042c0d57ab2279e8a08`. Diff `91592850d11510bf5fb7a972.diff`, SHA-256 `6d5f5fa2c86f85e4d501a0974a150324bbbc02268b9b78bd603cbf5535a86b0c`.

## runtime/node/process/tsconfig.json (rc)

`URL#get host`: The live URL receiver owns its record throughout serializeHost, which reads only host and port and constructs a string. Its numeric append cannot mutate that record or invoke program code, so the temporary record retain/release pair is unnecessary.

Before HIR `0d319e5f23b88f0740a558f245278b7b5471a505d366b3ec4a75c9d4076e5dae`; effect-only HIR `30209db5cb9d1ea1b5c5a3a30eadbb4bf25a13fa6590d2ee3529ac0e1f0af48f`. Diff `9c0875bd7495824282046ac5.diff`, SHA-256 `af899046171de10fd911a4d1ea069c57cc16591efb26b1fa66f07ded9f359e7f`.

`URL#get host@raises`: The live URL receiver owns its record throughout serializeHost, which reads only host and port and constructs a string. Its numeric append cannot mutate that record or invoke program code, so the temporary record retain/release pair is unnecessary.

Before HIR `0d319e5f23b88f0740a558f245278b7b5471a505d366b3ec4a75c9d4076e5dae`; effect-only HIR `30209db5cb9d1ea1b5c5a3a30eadbb4bf25a13fa6590d2ee3529ac0e1f0af48f`. Diff `568011ca11480c7965b1e6e5.diff`, SHA-256 `536309f1ac5bd12d08a0f913134c5aa055a8467dc603518635aef99bcf3a2c0e`.

## runtime/node/tsconfig.json (rc)

`URL#get host`: The live URL receiver owns its record throughout serializeHost, which reads only host and port and constructs a string. Its numeric append cannot mutate that record or invoke program code, so the temporary record retain/release pair is unnecessary.

Before HIR `9bf584dd2fd801c1f39993034e805f6cff71289244d7cf008a7cf9def3a7eb05`; effect-only HIR `46c6d7f94e8eca562ddba547386020ab86f7996ec7c65e9553fe96b27eee51d7`. Diff `34022e68de5e4f36b65cd1c3.diff`, SHA-256 `628f8da568a76e6e10abfac68bfbe1647b42964eef3f9c029d476863fc6d9eaf`.

## runtime/node/url/tsconfig.json (rc)

`URL#get host`: The live URL receiver owns its record throughout serializeHost, which reads only host and port and constructs a string. Its numeric append cannot mutate that record or invoke program code, so the temporary record retain/release pair is unnecessary.

Before HIR `1298c8282b28d469ce25fdbbcdaeb1a37c929ffa8d110fa17ddd0e94606fb131`; effect-only HIR `4c6392e12b47043659c411d4890225b4e81d7004bf10920f0c62232bd04c8105`. Diff `ab63ffc323b9427de23b5f9c.diff`, SHA-256 `af6fbf58cdf5a50a24de208fd8c7bacfded5fc3c1ac4f119021d7756d90feaa9`.

`URL#get host@raises`: The live URL receiver owns its record throughout serializeHost, which reads only host and port and constructs a string. Its numeric append cannot mutate that record or invoke program code, so the temporary record retain/release pair is unnecessary.

Before HIR `1298c8282b28d469ce25fdbbcdaeb1a37c929ffa8d110fa17ddd0e94606fb131`; effect-only HIR `4c6392e12b47043659c411d4890225b4e81d7004bf10920f0c62232bd04c8105`. Diff `ceb8cc6f53073cf8a0d23813.diff`, SHA-256 `1ea77589bdc50bc5ee3100c71a09b191833e29941f8bf750e24bdc7f0f339ffb`.

## runtime/node/zlib/tsconfig.json (rc)

`URL#get host`: The live URL receiver owns its record throughout serializeHost, which reads only host and port and constructs a string. Its numeric append cannot mutate that record or invoke program code, so the temporary record retain/release pair is unnecessary.

Before HIR `4511cc6c03b60c5d024e983742d24a2146340466c76f99c32262f657ed6ba870`; effect-only HIR `57cd2eebfedb708c6f37900839e28b15a2208e93bdea9ee80c288b4bd5467261`. Diff `7b28b28ee5961995ccb0f24d.diff`, SHA-256 `2d5728f1a8e88db4f122d7e7a8e93b2e54ce8dcb98e80878c9aa4aa525242850`.

## tests/interop/macos-hello/tsconfig.json (rc)

`module#init`: The live global string is borrowed across construction of an independent appended suffix. Append cannot replace that global. Nonconsuming concat reads the borrowed left string; the later global store still releases the previous owner.

Before HIR `f32df0e113b62edd0ca938b06ddfc9fdf1573daddae2dc4cf3bd3e3ba0c29422`; effect-only HIR `fa5c5fcff6ef8dde8c7de0bcd8cbe0703178d14d5abc996efa10dd4f5454d1d2`. Diff `68bbcc6da0ad65937fe68c07.diff`, SHA-256 `12716349738cabb6d780244aee65e6d8338a473d420fb267821f7bfad79628a8`.

## tests/memory/field-overwrite-in-loop-control/tsconfig.json (rc)

`work`: kept.first.text stays borrowed from the live kept holder across creation of the independent expected entry string. Append cannot reach kept or call program code; the field cleanup follows the comparison. Its redundant retain/release pair disappears.

Before HIR `5bb08b0256a1701a15a5730ac15a23860336f563ef50d24ba60bd61a693acc13`; effect-only HIR `cf10ceefc70bb823328c515c2443c5157cc5005f7555accd534478fb988ae0d5`. Diff `9230524deb12a6da0ddbcbcc.diff`, SHA-256 `56518d3d99f61c7b22bd02fa2b55b68a3b76ac5e33adaf90117f1cd6759ecd7b`.

`work#whole`: kept.first.text stays borrowed from the live kept holder across creation of the independent expected entry string. Append cannot reach kept or call program code; the field cleanup follows the comparison. Its redundant retain/release pair disappears.

Before HIR `5bb08b0256a1701a15a5730ac15a23860336f563ef50d24ba60bd61a693acc13`; effect-only HIR `cf10ceefc70bb823328c515c2443c5157cc5005f7555accd534478fb988ae0d5`. Diff `6789b58a8b165d3913b36432.diff`, SHA-256 `e24ac1af7f8f303f8f54fa6f3b52c298b5f2010a8921c3ad43b43bf49df7d6d4`.

## tests/memory/field-overwrite-in-loop/tsconfig.json (rc)

`work`: kept.first.text stays borrowed from the live kept holder across creation of the independent expected entry string. Append cannot reach kept or call program code; the field cleanup follows the comparison. Its redundant retain/release pair disappears.

Before HIR `ff402e45d86d07214f5844b09834f208fae3bb67f65eee7f422344418f540f21`; effect-only HIR `262bb4be31dad47277307ea425cc65047cc0aea104e5bb545ae214f6ccb4fe2e`. Diff `9703286e16d896fcb3885e9e.diff`, SHA-256 `cf2256fe42c6b30c9d273c7ef9fe007b9ac59364bc0111e3b94a806a04372b60`.

`work#whole`: kept.first.text stays borrowed from the live kept holder across creation of the independent expected entry string. Append cannot reach kept or call program code; the field cleanup follows the comparison. Its redundant retain/release pair disappears.

Before HIR `ff402e45d86d07214f5844b09834f208fae3bb67f65eee7f422344418f540f21`; effect-only HIR `262bb4be31dad47277307ea425cc65047cc0aea104e5bb545ae214f6ccb4fe2e`. Diff `3be45098fad2f8739be079a8.diff`, SHA-256 `f5497031b1d97a1e2f4e99d64d549b90b8fd0584633c80779ed1e24f28e79394`.

## tests/outcomes/a-static-field-defined-twice-control-on-jvm/tsconfig.json (rc)

`definedOnceEach`: The global owns the string throughout the numeric conversion. Borrowed concat_number replaces retain plus consuming append_number, preserving the global contents and ownership.

Before HIR `9b3d84b0ae29eab56a4a57fbec6ff142725063d9aa89e5fccc7e9a12fc3e0c06`; effect-only HIR `8a27edd467b3c7f8edb2511250398ae45b98e730d0ab7d909161585d908c4078`. Diff `5bf72b8b8372006e6676edb2.diff`, SHA-256 `6df30514d1e5a9cdfadb324c1330f369ef3f0d77e8fcdf4c9d2cabcd36dcc427`.

## tests/outcomes/a-static-field-defined-twice-control-on-llvm/tsconfig.json (rc)

`definedOnceEach`: The global owns the string throughout the numeric conversion. Borrowed concat_number replaces retain plus consuming append_number, preserving the global contents and ownership.

Before HIR `d2bf1a481d05df1a4137c9b2de7daf0d94f51438ea02f571c08223b895eff895`; effect-only HIR `59554cb310b4c87aef55cdbd1ade20a623d1916c95cdd540134082678bde8c21`. Diff `a3ea84142599f09fe1c9ff79.diff`, SHA-256 `3c7e9abb7b6ccdc5520899e1cd2f6709a0fcbad23084e5d8c038328a2d6efac0`.

## tests/outcomes/a-static-field-defined-twice-jvm/tsconfig.json (rc)

`definedTwice`: The global owns the string throughout the numeric conversion. Borrowed concat_number replaces retain plus consuming append_number, preserving the global contents and ownership.

Before HIR `5ba742ca0f160e0286c798f797f408ee0a514f9106d51baa7743d89873893e93`; effect-only HIR `880dcb98c5e7069c9091ddefd862e9a11162826e620c9818c63ec17d4f9ea2f7`. Diff `b3fe5419637401236aba34ba.diff`, SHA-256 `1b3f1edf3104cfb23be3e7265362377cbfbd95e2eddf3313523691459acf33c0`.

## tests/outcomes/a-static-field-defined-twice-llvm/tsconfig.json (rc)

`definedTwice`: The global owns the string throughout the numeric conversion. Borrowed concat_number replaces retain plus consuming append_number, preserving the global contents and ownership.

Before HIR `05ec797e6539b743e866f69ac0bfc08af6e5b81707a91ccb90720a05988e7dc5`; effect-only HIR `cc8ea86283fdd519df87f0a41d8a9f6cea02141fe8e3d4d5f011a3bb738d52d9`. Diff `4872373ebe86c3a13a190290.diff`, SHA-256 `0c23889356ce39dde797dd328fee1b350004d9ac489ad9c23796f190c39fc4f3`.

## tests/outcomes/a-var-redeclared-returning-another-object-layout/tsconfig.json (rc)

`sameLayout`: The returned object owns its b string until concat_number has read it. Nonconsuming concat runs before the owner release, replacing a retained string passed to consuming append without changing the result.

Before HIR `987ad8da2d5a4489640dcd96c485c15935b029da5eccbe8f478fb03ea5b49985`; effect-only HIR `0cef0648fca31f10f223722a498a7ae299487255ea2f044365b08b4ad74156c9`. Diff `2523a966a4a9fa911eaeb568.diff`, SHA-256 `432454df5e48fff702e402ea91441260558632848910221d0d567f4a0bc0bb38`.

## tests/programs/a-call-on-a-cast-inside-a-closure/tsconfig.json (rc)

`Closure2#call`: The live global string is borrowed across construction of an independent appended suffix. Append cannot replace that global. Nonconsuming concat reads the borrowed left string; the later global store still releases the previous owner.

Before HIR `9da68ec9e41f2f8628229fcc384475d88d9342d110d3a304a35d645ac218cd41`; effect-only HIR `1546bad1da579c8bf18206fdcb12bb7b1c8430f390822340ef1458165dddd73e`. Diff `146babf17cdc3286c104edcf.diff`, SHA-256 `8e9162e8111901371354c696549f3acfd6e53e548321c6131cdc6734efb40d8c`.

## tests/programs/a-class-whose-fields-begin-with-a-face-passed-as-it/tsconfig.json (rc)

`describe`: The live receiver or local array owns the selected string throughout numeric concatenation. concat_number reads that borrow without consuming it, so retain plus append_number is unnecessary.

Before HIR `82fb727b9a45f3e2d1d0a1821b2949165dff0e250494aa0519751dae00fb12fe`; effect-only HIR `f6df0cb7aadfbaa58b11d90d53b9ce6704f871a8afeec9b07594d548b7e278fb`. Diff `824ee1ea28304d9f3821eb65.diff`, SHA-256 `789eafa22e864a5d562aa2002ed89ca27324c96305c4d34e24b6d5144c0fbf6a`.

`describe@0obj4`: The live receiver or local array owns the selected string throughout numeric concatenation. concat_number reads that borrow without consuming it, so retain plus append_number is unnecessary.

Before HIR `82fb727b9a45f3e2d1d0a1821b2949165dff0e250494aa0519751dae00fb12fe`; effect-only HIR `f6df0cb7aadfbaa58b11d90d53b9ce6704f871a8afeec9b07594d548b7e278fb`. Diff `9cab7f60dc99827a098c4aa2.diff`, SHA-256 `de48d4acf3e5f153ce898de4718383904225022c0f553ddf056d9f5d96da32b2`.

## tests/programs/a-class-with-its-own-tostring/tsconfig.json (rc)

`Labelled#toString`: The live Labelled receiver owns label throughout Point.toString, whose body only reads x and y and constructs strings. The shared append effect keeps that call read-only; nonconsuming concat safely reads label after it.

Before HIR `c366f0dbebdc7a9dadcf068ba6fd18140c59eddefb66f727a8437feb4dff9aa2`; effect-only HIR `f27560ef69a33908eb26cdd31960a31ade4bfb1f9382d59576983750d4d192e3`. Diff `62d3e5a37c950d9605abb80e.diff`, SHA-256 `3652d4c598a989234d8a0b2833b9be0bdad40bf53c6a91aac63aa6e89967b57d`.

## tests/programs/a-closure-entered-through-a-signature-it-was-not-written-at/tsconfig.json (rc)

`aStringReadAsAValue`: The global makesAString owns the closure throughout its direct call. The body formats n using append_number and cannot replace the global or invoke callbacks; retaining and releasing the borrowed closure around the call is redundant.

Before HIR `ce7d7fa909ea856eccf32eea742aaebaaf52bbe815d3dac4a45260a52da16487`; effect-only HIR `2da28c417d89f864e4a3deb24a8f7d13c15b3524caa475ce530db697ea211a52`. Diff `85cfa8e8e98df5803498a65c.diff`, SHA-256 `bc0f898f8b0e34b06fd6dee99be225393373463ee541da7039d749945d0925f6`.

`atTheirOwnType`: The global makesAString owns the closure throughout its direct call. The body formats n using append_number and cannot replace the global or invoke callbacks; retaining and releasing the borrowed closure around the call is redundant.

Before HIR `ce7d7fa909ea856eccf32eea742aaebaaf52bbe815d3dac4a45260a52da16487`; effect-only HIR `2da28c417d89f864e4a3deb24a8f7d13c15b3524caa475ce530db697ea211a52`. Diff `2b2fcec6718d38ed16934581.diff`, SHA-256 `727f17bd45d1ee5acd0babbf4d03e80e3b55aa049803de7ee028cd53d10ab27b`.

## tests/programs/a-copied-record-gives-back-its-keys/tsconfig.json (rc)

`built`: The release changes from erased key %13 to its original string %11, the same owned allocation. Building the independent value string with append_number leaves the key borrow valid; map_set still retains its stored key and value. Counts are unchanged.

Before HIR `3985b02d563b79baa9926441b5f8b7751825486958337eac766bce372fd3a31a`; effect-only HIR `81b9ec2026f5f82402d334c6622fff39da0f992fc67f472f9a2bc418e3488c6c`. Diff `883167f99192a4baa8449c16.diff`, SHA-256 `19a26abf0812658937d499ed2cf74c7bc7da4d7f2f77f7cec7449b5bab8fbfbd`.

## tests/programs/a-json-string-quoted-onto-a-string/tsconfig.json (rc)

`key`: The live receiver or local array owns the selected string throughout numeric concatenation. concat_number reads that borrow without consuming it, so retain plus append_number is unnecessary.

Before HIR `e567fbdeb758c935b098616c6a5658848db1066867a32b5a192692b125753e76`; effect-only HIR `73365ab354e74921f8c7b41e80d88c71907850f29b39ef485aab6bb5c4a63d2a`. Diff `ebb9bbc51dbb1a68fe5dfbac.diff`, SHA-256 `f9886b9bde439431ef6db29b3dd49ec6aa7291d6044061414191f6da5f95b972`.

## tests/programs/a-method-an-interface-inherits-from-another/tsconfig.json (rc)

`throughBase`: Both phi alternatives are frame objects with only scalar or no fields. Every reachable label/tag/mark/size/both implementation reads its receiver and builds independent strings. The shared append contract preserves the inert-cleanup proof across the virtual calls, so the frame receiver release has nothing to retire.

Before HIR `bef9405a95989c693e2a3db5597abade2e57889ec670c67d7ea423fa7c37f68a`; effect-only HIR `f6d1ccbfc16022878c10ebaba8a82e00e436e3dfb3dc66da3f0eb6e34e5f0303`. Diff `834534e16399e247fb534c30.diff`, SHA-256 `d3fd1f50e5dda8849db6b5f9d7a8eb2509b80bb48f97c7ea81987fb2d35c7ebc`.

`throughTheDeclaringBase`: The live all array owns each Named receiver throughout label. All possible label implementations read their receiver and construct independent strings with append helpers, without replacing an array entry or invoking callbacks. The temporary receiver retain/release pair is redundant.

Before HIR `bef9405a95989c693e2a3db5597abade2e57889ec670c67d7ea423fa7c37f68a`; effect-only HIR `f6d1ccbfc16022878c10ebaba8a82e00e436e3dfb3dc66da3f0eb6e34e5f0303`. Diff `7fa7bab1bfbfcc7c2e2e269d.diff`, SHA-256 `4b4e0db52fce0977ee88901db1ef89382d5849125ec0ff81c04a160314980ac1`.

`throughTheDeclaringBase#whole`: The live all array owns each Named receiver throughout label. All possible label implementations read their receiver and construct independent strings with append helpers, without replacing an array entry or invoking callbacks. The temporary receiver retain/release pair is redundant.

Before HIR `bef9405a95989c693e2a3db5597abade2e57889ec670c67d7ea423fa7c37f68a`; effect-only HIR `f6d1ccbfc16022878c10ebaba8a82e00e436e3dfb3dc66da3f0eb6e34e5f0303`. Diff `8953f4bd0fc22655c6f82f7d.diff`, SHA-256 `e5a2761b0371033ec99c89542ec15183c7f894a9def68dd9ef04b6619c80d8b6`.

`throughTwoLevels`: Both phi alternatives are frame objects with only scalar or no fields. Every reachable label/tag/mark/size/both implementation reads its receiver and builds independent strings. The shared append contract preserves the inert-cleanup proof across the virtual calls, so the frame receiver release has nothing to retire.

Before HIR `bef9405a95989c693e2a3db5597abade2e57889ec670c67d7ea423fa7c37f68a`; effect-only HIR `f6d1ccbfc16022878c10ebaba8a82e00e436e3dfb3dc66da3f0eb6e34e5f0303`. Diff `48481520408e7ec9ba0c5d38.diff`, SHA-256 `bd3aa1a482b770603f34313a5264985a7bed742b310d9a5f84bd0e121a575244`.

`twoBases`: Both phi alternatives are frame objects with only scalar or no fields. Every reachable label/tag/mark/size/both implementation reads its receiver and builds independent strings. The shared append contract preserves the inert-cleanup proof across the virtual calls, so the frame receiver release has nothing to retire.

Before HIR `bef9405a95989c693e2a3db5597abade2e57889ec670c67d7ea423fa7c37f68a`; effect-only HIR `f6d1ccbfc16022878c10ebaba8a82e00e436e3dfb3dc66da3f0eb6e34e5f0303`. Diff `e8ee149183a2a26001a7d457.diff`, SHA-256 `049c72614f78545e2d947796c4b62adf46955554e7e0b45ad8b2ed7f2168496a`.

## tests/programs/a-rest-tuple-stored-in-a-field-and-spread/tsconfig.json (rc)

`mixed`: The global string stays owned throughout construction of the independent expected s-number string. Append_number cannot change the global or invoke program code, so the comparison uses its borrow without the temporary retain/release pair.

Before HIR `37cd145b13b7191c7444a70b386eb4db2a0a4bb73934af1d84e73203672adf9c`; effect-only HIR `4a76ff961a9b1afabef18aeccc3f6e9c3208df31180b3de12ea7b5c1d5fe89b8`. Diff `e3fab511309afb75579e8d0e.diff`, SHA-256 `ce8e5bbcdd10b2d90f967a38cb8f62d340fef1d1ec9a1c4b28f0e2ff1ba55337`.

## tests/programs/a-spread-that-runs-a-getter/tsconfig.json (rc)

`theOrderTwoGettersRunIn`: The global trace string owns its prefix while the already-spread numeric fields are read. No getter call occurs in this prepared body. Nonconsuming concat_number reads the prefix without changing the global, replacing retain plus consuming append_number.

Before HIR `3236e0b46c6260a67176b06146518ad322a47dc9e9b75c695269b16a6d2fda6d`; effect-only HIR `90c66a68798f30e462cf22af58ef1537cbacd0b3e6e62f0273fe3b6d87a32790`. Diff `8d166764f400034c50cc27eb.diff`, SHA-256 `b37132a49913e0a9d527d0ab89dfe0b64d59e175997d7b08a750fe316d0100f6`.

## tests/programs/a-string-chain-made-with-room/tsconfig.json (rc)

`joined`: The live source array owns the selected prefix through numeric concatenation. concat_number reads that borrow and produces an independent string for the output array, replacing retain plus consuming append_number.

Before HIR `d803351ec02ab4c10d7e4302a76b7ef9853b2f958f8fe3c0231e3870cc5f86b0`; effect-only HIR `e173b8a15f3a05ef3d9bd7e568a339ad0e2e73a188f4155f6aeb1c52651a9f72`. Diff `a853552bf805898789afc352.diff`, SHA-256 `b86b6bbe4e0944a625e6d26284b9ac58623c227627899d2767d6912254f0ee6f`.

`joined#whole`: The live source array owns the selected prefix through numeric concatenation. concat_number reads that borrow and produces an independent string for the output array, replacing retain plus consuming append_number.

Before HIR `d803351ec02ab4c10d7e4302a76b7ef9853b2f958f8fe3c0231e3870cc5f86b0`; effect-only HIR `e173b8a15f3a05ef3d9bd7e568a339ad0e2e73a188f4155f6aeb1c52651a9f72`. Diff `498c36dc3176e0c12deea848.diff`, SHA-256 `9a90c281d986eea2f0510318af261f0eca50df20577da4f80ff104664fcdb8c5`.

## tests/programs/an-accessor-that-enumerates/tsconfig.json (rc)

`entriesCarryBoth`: The live entries array and its known local entry records own each key through nonconsuming concat_number. Its owner release moves after the last key read and before the independent output join; frame cleanup has no foreign payload or callback.

Before HIR `73c7fba11cf96f12e84ec52e5b13c4e0bfe514db7a6d4bdf438090eba70a3e2f`; effect-only HIR `27ed795c55f69b8dfe922d7647047ce708e78f09a2394d192ff0a97afa172846`. Diff `928b4bab0fb0d57f022b0fae.diff`, SHA-256 `53a02a734e0ab4cd9c09ad6bcef52e7dc6bf3424af7abd3ee01c6c12ccb3bc01`.

## tests/programs/an-await-of-an-erased-promise/tsconfig.json (rc)

`erasedRejection__resume`: The known rejected Error packet remains live through comparison of its message with an independently built string. Pure append no longer invalidates that borrow; releasing the packet after the comparison replaces the message retain/release pair without crossing a callback.

Before HIR `56108695c1a195d64c98b60cb39910f59d4ef7a23f6c566ac17e86ff86bb4f5a`; effect-only HIR `cc9d37c0457b17492784159b1626ec89f9babb14aec904f4c8393c0761ef5800`. Diff `69f8e435d328d2f319b280bd.diff`, SHA-256 `b77d19118f26d43ba779751cfeadd9df7655ee333a668c75326b1bbe74f30eb1`.

## tests/programs/an-erased-holder-read-back-as-a-face-with-a-field/tsconfig.json (rc)

`run`: The local erased array owns the Person receiver through back(), whose only dispatch is Person.greet reading its name and formatting a string. Delaying the array release until that read finishes removes the temporary receiver retain/release pair.

Before HIR `0c048a90da761ad03df07cbab74421be53826ac12d13c63e5941959267d88947`; effect-only HIR `cf6102eaa09ef117b29052c56995144e917f9395aea665217748d1d6485fe4e6`. Diff `358d3b1e798bfee2d7c445f6.diff`, SHA-256 `6c19f5fda1bfb5ea885fee55058623c20853c5ace1e6c99252f286dfc38a21aa`.

## tests/programs/control/tsconfig.json (rc)

`resolvedLikePath#whole`: The live words array anchors words used only by the nonconsuming right operand of append. A retain remains on the branch that transfers a word into the owned accumulator. The array is released after the last word read and fallback choice, before the independent final append; all intervening cleanup is local.

Before HIR `9a585afaf0ec1f0c22f119af0b20610e77e63c399cc4b84a7ee9f572e4cccde7`; effect-only HIR `d086cafad69da09ba7537daadb07436f6c037f504b84792b81b3783cd8ee138f`. Diff `1bdeaaa55c7ca32fd0907237.diff`, SHA-256 `35ba528b83daece3284e4b4f5bb0928c9a61895545674d5ff8cc5777c4220b85`.

## tests/programs/destructuring-in-a-for-of/tsconfig.json (rc)

`mixedTuples`: The live tuple array and tuple record own the string field while concat_number reads it. Replacing a consuming append of a retained field with nonconsuming concat removes the retain without changing the source owner lifetime.

Before HIR `1260009beb962510609279fb91cb318aa2d1c9f7170e3b41a77ac480785079d4`; effect-only HIR `5b30100d3a8e605d3812d91affdf250ea8dbab4f25dde22fe100bac6f96103f4`. Diff `e7a36a610cf8d0c36dc872d4.diff`, SHA-256 `6eaa0463ccee13deda19375f5d6a2f9638cb7b1e77a704b32d5f5096be27aae3`.

`mixedTuples#whole`: The live tuple array and tuple record own the string field while concat_number reads it. Replacing a consuming append of a retained field with nonconsuming concat removes the retain without changing the source owner lifetime.

Before HIR `1260009beb962510609279fb91cb318aa2d1c9f7170e3b41a77ac480785079d4`; effect-only HIR `5b30100d3a8e605d3812d91affdf250ea8dbab4f25dde22fe100bac6f96103f4`. Diff `08123a2f6b53ace771620d36.diff`, SHA-256 `b01e1498c70371481f5752f1e4014fc048ac9be3de8b82926d463664873425c3`.

## tests/programs/object-values-and-entries/tsconfig.json (rc)

`indexed`: The entries array remains live through concat_number reading the selected entry key; releasing the array afterward removes the temporary key retain while preserving its anchor through the final read.

Before HIR `103082bf7fcda4a09b20d4a42a2c10c9fe0e69e48d77d0e287cd318e05d2ed7d`; effect-only HIR `16a9d7980a548696c6492a2ff5e263caed81d0f874b817ca303625274903d4d7`. Diff `a51c24f0a97d0e4e326b374d.diff`, SHA-256 `a26d59dcc7c600f6cc9352b4e21bd923a5448a595b3daf1f313696c8e5f5a60d`.

`walkBoth`: The entries array owns each key through nonconsuming concat_number. Its release moves to the loop exit after the last key read and before the final independent numeric append; no input writer or callback intervenes.

Before HIR `103082bf7fcda4a09b20d4a42a2c10c9fe0e69e48d77d0e287cd318e05d2ed7d`; effect-only HIR `16a9d7980a548696c6492a2ff5e263caed81d0f874b817ca303625274903d4d7`. Diff `3771abb95a42ee087c3ea071.diff`, SHA-256 `b8fab9642f8ae26e8d9759166ca9cbef57711b07a97a0072b4fb5e48eee1f444`.

`walkBoth#whole`: The entries array owns each key through nonconsuming concat_number. Its release moves to the loop exit after the last key read and before the final independent numeric append; no input writer or callback intervenes.

Before HIR `103082bf7fcda4a09b20d4a42a2c10c9fe0e69e48d77d0e287cd318e05d2ed7d`; effect-only HIR `16a9d7980a548696c6492a2ff5e263caed81d0f874b817ca303625274903d4d7`. Diff `a90ad6ce2faeb792e37c7ec4.diff`, SHA-256 `469a92261fc7c884c187b79a818b6b7f98c2b6ea1edfaa6ce1cc15613fcec765`.

## tests/programs/reduce-with-no-initial-value/tsconfig.json (rc)

`strings#whole`: Only the pure constant 1 moves ahead of an unchanged retain during liveness insertion. Ownership and operation counts do not change; this is scheduling, not a profitable version.

Before HIR `22141b43e12b64c6f277253152e96ba1d0efffa7aab38189c3ddbf8ac49f427d`; effect-only HIR `310ae6786823b61d4d5d92699d83df54a54c2cb8101b2f491e469bef6eb976b6`. Diff `85d1e6461c1a53310dfe69d4.diff`, SHA-256 `0c9fac95069598c225c4e85442249586fddfe05218291d28cea4edfadff08be5`.

## tests/refusals/a-generic-called-with-null-arguments/tsconfig.json (rc)

`Labelled`: The caller-held receiver owns its string field through numeric concatenation. concat_number reads the field borrow without consuming it; the unrelated generic-null refusal remains unchanged.

Before HIR `9ad0dd0943117e85121ac0ebd042fe60189351212a60f106dde17d6e37aabb6b`; effect-only HIR `c7b6bfde55724b8807f6d33726423d98afe4e26fcef1bb2122dc106b4a2fe5d7`. Diff `c3fd81898e704ae583930b36.diff`, SHA-256 `dda50754f17834eaa2320f174af860da0e5a547b32dac4fdb43323de8bb995cb`.

## tests/refusals/an-event-dispatched-to-a-listener/tsconfig.json (rc)

`serializeWrappedJwk`: The borrowed internal typed JWK dictionary owns all string fields, key_ops elements and nested oth records throughout serialization. stringJsonMember and quoteAscii only read these inputs and append to independent local accumulators; no prototype hook, callback or input write runs. Removing their conservative invalidation removes 22 temporary retain/release pairs.

Before HIR `8a7004d50cc2ac1f79baa6ee76a9172c9f125d80c689c552be1c2f31ad6f0baa`; effect-only HIR `0b7838dd600ae694adabc2ab25540e8923f772593551487e76d0c67bff4f102d`. Diff `eace2aa3b9de9ea5a8663f3a.diff`, SHA-256 `a6b7202e4cc3fbe922f77260913b3c99fb5b3a6ab6c02164c7dc40a4e8cc37cc`.
