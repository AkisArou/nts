// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/codefixes/fixModuleAndTargetOptions.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { createCodeFixActionWithoutFixAll, registerCodeFix, setJsonCompilerOptionValue, setJsonCompilerOptionValues } from "../_namespaces/ts.codefix.ts";
import { type CodeFixAction, Diagnostics, type Expression, factory, getEmitModuleKind, getEmitScriptTarget, getTsConfigObjectLiteralExpression, ModuleKind, ScriptTarget, textChanges } from "../_namespaces/ts.ts";
registerCodeFix({
    errorCodes: [
        Diagnostics.Top_level_await_expressions_are_only_allowed_when_the_module_option_is_set_to_es2022_esnext_system_node16_node18_node20_nodenext_or_preserve_and_the_target_option_is_set_to_es2017_or_higher.code,
        Diagnostics.Top_level_await_using_statements_are_only_allowed_when_the_module_option_is_set_to_es2022_esnext_system_node16_node18_node20_nodenext_or_preserve_and_the_target_option_is_set_to_es2017_or_higher.code,
        Diagnostics.Top_level_for_await_loops_are_only_allowed_when_the_module_option_is_set_to_es2022_esnext_system_node16_node18_node20_nodenext_or_preserve_and_the_target_option_is_set_to_es2017_or_higher.code,
    ],
    getCodeActions: function getCodeActionsToFixModuleAndTarget(context) {
        const compilerOptions = context.program.getCompilerOptions();
        const { configFile } = compilerOptions;
        if (configFile === undefined) {
            return undefined;
        }
        const codeFixes: CodeFixAction[] = [];
        const moduleKind = getEmitModuleKind(compilerOptions);
        const moduleOutOfRange = moduleKind >= ModuleKind.ES2015 && moduleKind < ModuleKind.ESNext;
        if (moduleOutOfRange) {
            const changes = textChanges.ChangeTracker.with(context, changes => {
                setJsonCompilerOptionValue(changes, configFile, "module", factory.createStringLiteral("esnext"));
            });
            codeFixes.push(createCodeFixActionWithoutFixAll("fixModuleOption", changes, [Diagnostics.Set_the_module_option_in_your_configuration_file_to_0, "esnext"]));
        }
        const target = getEmitScriptTarget(compilerOptions);
        const targetOutOfRange = target < ScriptTarget.ES2017 || target > ScriptTarget.ESNext;
        if (targetOutOfRange) {
            const changes = textChanges.ChangeTracker.with(context, tracker => {
                const configObject = getTsConfigObjectLiteralExpression(configFile);
                if (!configObject)
                    return;
                const options: [
                    string,
                    Expression
                ][] = [["target", factory.createStringLiteral("es2017")]];
                if (moduleKind === ModuleKind.CommonJS) {
                    // Ensure we preserve the default module kind (commonjs), as targets >= ES2015 have a default module kind of es2015.
                    options.push(["module", factory.createStringLiteral("commonjs")]);
                }
                setJsonCompilerOptionValues(tracker, configFile, options);
            });
            codeFixes.push(createCodeFixActionWithoutFixAll("fixTargetOption", changes, [Diagnostics.Set_the_target_option_in_your_configuration_file_to_0, "es2017"]));
        }
        return codeFixes.length ? codeFixes : undefined;
    },
});
