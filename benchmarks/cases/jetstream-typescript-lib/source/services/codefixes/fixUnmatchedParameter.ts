// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/codefixes/fixUnmatchedParameter.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { requireCompilerMember } from "../../checked.ts";
import { createCodeFixAction, createCodeFixActionWithoutFixAll, createCombinedCodeActions, eachDiagnostic, registerCodeFix } from "../_namespaces/ts.codefix.ts";
import { type __String, append, type CodeFixAction, type CodeFixContext, Diagnostics, factory, firstDefined, getHostSignatureFromJSDoc, getJSDocHost, getJSDocTags, getTokenAtPosition, type HasJSDoc, type Identifier, isIdentifier, isJSDocParameterTag, type JSDocParameterTag, type JSDocTag, length, map, type SignatureDeclaration, type SourceFile, textChanges } from "../_namespaces/ts.ts";
const deleteUnmatchedParameter = "deleteUnmatchedParameter";
const renameUnmatchedParameter = "renameUnmatchedParameter";
const errorCodes = [
    Diagnostics.JSDoc_param_tag_has_name_0_but_there_is_no_parameter_with_that_name.code,
];
registerCodeFix({
    fixIds: [deleteUnmatchedParameter, renameUnmatchedParameter],
    errorCodes,
    getCodeActions: function getCodeActionsToFixUnmatchedParameter(context) {
        const { sourceFile, span } = context;
        const actions: CodeFixAction[] = [];
        const info = getInfo(sourceFile, span.start);
        if (info) {
            append(actions, getDeleteAction(context, info));
            append(actions, getRenameAction(context, info));
            return actions;
        }
        return undefined;
    },
    getAllCodeActions: function getAllCodeActionsToFixUnmatchedParameter(context) {
        const tagsToSignature = new Map<SignatureDeclaration, JSDocTag[]>();
        return createCombinedCodeActions(textChanges.ChangeTracker.with(context, changes => {
            eachDiagnostic(context, errorCodes, ({ file, start }) => {
                const info = getInfo(file, start);
                if (info) {
                    tagsToSignature.set(info.signature, append(tagsToSignature.get(info.signature), info.jsDocParameterTag));
                }
            });
            tagsToSignature.forEach((tags, signature) => {
                if (context.fixId === deleteUnmatchedParameter) {
                    const tagsSet = new Set(tags);
                    changes.filterJSDocTags(requireCompilerMember(signature, "getSourceFile").getSourceFile(), signature, t => !tagsSet.has(t));
                }
            });
        }));
    },
});
function getDeleteAction(context: CodeFixContext, { name, jsDocHost, jsDocParameterTag }: Info) {
    const changes = textChanges.ChangeTracker.with(context, changeTracker => changeTracker.filterJSDocTags(context.sourceFile, jsDocHost, t => t !== jsDocParameterTag));
    return createCodeFixAction(deleteUnmatchedParameter, changes, [Diagnostics.Delete_unused_param_tag_0, requireCompilerMember(name, "getText").getText(context.sourceFile)], deleteUnmatchedParameter, Diagnostics.Delete_all_unused_param_tags);
}
function getRenameAction(context: CodeFixContext, { name, jsDocHost, signature, jsDocParameterTag }: Info) {
    if (!length(signature.parameters))
        return undefined;
    const sourceFile = context.sourceFile;
    const tags = getJSDocTags(signature);
    const names = new Set<__String>();
    for (const tag of tags) {
        if (isJSDocParameterTag(tag) && isIdentifier(tag.name)) {
            names.add(tag.name.escapedText);
        }
    }
    // @todo - match to all available names instead to the first parameter name
    // @see /codeFixRenameUnmatchedParameter3.ts
    const parameterName = firstDefined(signature.parameters, p => isIdentifier(p.name) && !names.has(p.name.escapedText) ? requireCompilerMember(p.name, "getText").getText(sourceFile) : undefined);
    if (parameterName === undefined)
        return undefined;
    const newJSDocParameterTag = factory.updateJSDocParameterTag(jsDocParameterTag, jsDocParameterTag.tagName, factory.createIdentifier(parameterName), jsDocParameterTag.isBracketed, jsDocParameterTag.typeExpression, jsDocParameterTag.isNameFirst, jsDocParameterTag.comment);
    const changes = textChanges.ChangeTracker.with(context, changeTracker => changeTracker.replaceJSDocComment(sourceFile, jsDocHost, map(tags, t => t === jsDocParameterTag ? newJSDocParameterTag : t)));
    return createCodeFixActionWithoutFixAll(renameUnmatchedParameter, changes, [Diagnostics.Rename_param_tag_name_0_to_1, requireCompilerMember(name, "getText").getText(sourceFile), parameterName]);
}
interface Info {
    jsDocHost: HasJSDoc;
    signature: SignatureDeclaration;
    jsDocParameterTag: JSDocParameterTag;
    name: Identifier;
}
function getInfo(sourceFile: SourceFile, pos: number): Info | undefined {
    const token = getTokenAtPosition(sourceFile, pos);
    if (token.parent && isJSDocParameterTag(token.parent) && isIdentifier(token.parent.name)) {
        const jsDocParameterTag = token.parent;
        const jsDocHost = getJSDocHost(jsDocParameterTag);
        const signature = getHostSignatureFromJSDoc(jsDocParameterTag);
        if (jsDocHost && signature) {
            return { jsDocHost, signature, name: token.parent.name, jsDocParameterTag };
        }
    }
    return undefined;
}
