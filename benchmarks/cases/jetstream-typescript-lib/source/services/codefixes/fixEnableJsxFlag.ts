// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/codefixes/fixEnableJsxFlag.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { codeFixAll, createCodeFixActionWithoutFixAll, registerCodeFix, setJsonCompilerOptionValue } from "../_namespaces/ts.codefix.ts";
import { Diagnostics, factory, textChanges, type TsConfigSourceFile } from "../_namespaces/ts.ts";
const fixID = "fixEnableJsxFlag";
const errorCodes = [Diagnostics.Cannot_use_JSX_unless_the_jsx_flag_is_provided.code];
registerCodeFix({
    errorCodes,
    getCodeActions: function getCodeActionsToFixEnableJsxFlag(context) {
        const { configFile } = context.program.getCompilerOptions();
        if (configFile === undefined) {
            return undefined;
        }
        const changes = textChanges.ChangeTracker.with(context, changeTracker => doChange(changeTracker, configFile));
        return [
            createCodeFixActionWithoutFixAll(fixID, changes, Diagnostics.Enable_the_jsx_flag_in_your_configuration_file),
        ];
    },
    fixIds: [fixID],
    getAllCodeActions: context => codeFixAll(context, errorCodes, changes => {
        const { configFile } = context.program.getCompilerOptions();
        if (configFile === undefined) {
            return undefined;
        }
        doChange(changes, configFile);
    }),
});
function doChange(changeTracker: textChanges.ChangeTracker, configFile: TsConfigSourceFile) {
    setJsonCompilerOptionValue(changeTracker, configFile, "jsx", factory.createStringLiteral("react"));
}
