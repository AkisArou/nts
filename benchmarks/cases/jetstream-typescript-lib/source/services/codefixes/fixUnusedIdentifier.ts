// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/codefixes/fixUnusedIdentifier.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { requireCompilerMember } from "../../checked.ts";
import { isNodeLayout_bd1908686ab2 } from "../../checkedLayouts.ts";
import { testCompilerLayout } from "../../checked.ts";
import { isVariableDeclarationList as checked_isVariableDeclarationList } from "../_namespaces/ts.ts";
import { isVariableDeclaration as checked_isVariableDeclaration } from "../_namespaces/ts.ts";
import { present } from "../../checked.ts";
import { checkedCompilerLayout } from "../../checked.ts";
import { isFunctionLikeDeclaration as checked_isFunctionLikeDeclaration } from "../../compiler/utilitiesPublic.ts";
import { codeFixAll, createCodeFixAction, registerCodeFix } from "../_namespaces/ts.codefix.ts";
import { type ArrayBindingPattern, type CancellationToken, cast, type CodeFixAction, type CodeFixContext, Debug, type DiagnosticMessage, type DiagnosticOrDiagnosticAndArguments, Diagnostics, factory, type FileTextChanges, FindAllReferences, first, forEach, type FunctionLikeDeclaration, getJSDocParameterTags, getNewLineOrDefaultFromHost, getPrecedingNonSpaceCharacterPosition, getTokenAtPosition, type Identifier, type ImportDeclaration, isArrayBindingPattern, isBinaryExpression, isCallExpression, isCallLikeExpression, isComputedPropertyName, isDeclarationWithTypeParameterChildren, isExpressionStatement, isFunctionDeclaration, isIdentifier, isImportClause, isImportDeclaration, isInferTypeNode, isJSDocTemplateTag, isMethodDeclaration, isMethodSignature, isModifier, isObjectBindingPattern, isParameter, isPostfixUnaryExpression, isPrefixUnaryExpression, isPropertyAccessExpression, isSuperKeyword, isVariableDeclaration, isVariableDeclarationList, length, map, type Node, type ObjectBindingPattern, type ParameterDeclaration, probablyUsesSemicolons, type Program, showModuleSpecifier, type SourceFile, SyntaxKind, textChanges, tryCast, type TypeChecker, type VariableDeclaration, type VariableDeclarationList } from "../_namespaces/ts.ts";
const fixName = "unusedIdentifier";
const fixIdPrefix = "unusedIdentifier_prefix";
const fixIdDelete = "unusedIdentifier_delete";
const fixIdDeleteImports = "unusedIdentifier_deleteImports";
const fixIdInfer = "unusedIdentifier_infer";
const errorCodes = [
    Diagnostics._0_is_declared_but_its_value_is_never_read.code,
    Diagnostics._0_is_declared_but_never_used.code,
    Diagnostics.Property_0_is_declared_but_its_value_is_never_read.code,
    Diagnostics.All_imports_in_import_declaration_are_unused.code,
    Diagnostics.All_destructured_elements_are_unused.code,
    Diagnostics.All_variables_are_unused.code,
    Diagnostics.All_type_parameters_are_unused.code,
];
registerCodeFix({
    errorCodes,
    getCodeActions(context) {
        const { errorCode, sourceFile, program, cancellationToken } = context;
        const checker = program.getTypeChecker();
        const sourceFiles = program.getSourceFiles();
        const token = getTokenAtPosition(sourceFile, context.span.start);
        if (isJSDocTemplateTag(token)) {
            return [createDeleteFix(textChanges.ChangeTracker.with(context, t => t.delete(sourceFile, token)), Diagnostics.Remove_template_tag)];
        }
        if (token.kind === SyntaxKind.LessThanToken) {
            const changes = textChanges.ChangeTracker.with(context, t => deleteTypeParameters(t, sourceFile, token));
            return [createDeleteFix(changes, Diagnostics.Remove_type_parameters)];
        }
        const importDecl = tryGetFullImport(token);
        if (importDecl) {
            const changes = textChanges.ChangeTracker.with(context, t => t.delete(sourceFile, importDecl));
            return [createCodeFixAction(fixName, changes, [Diagnostics.Remove_import_from_0, showModuleSpecifier(importDecl)], fixIdDeleteImports, Diagnostics.Delete_all_unused_imports)];
        }
        else if (isImport(token)) {
            const deletion = textChanges.ChangeTracker.with(context, t => tryDeleteDeclaration(sourceFile, token, t, checker, sourceFiles, program, cancellationToken, /*isFixAll*/ false));
            if (deletion.length) {
                return [createCodeFixAction(fixName, deletion, [Diagnostics.Remove_unused_declaration_for_Colon_0, requireCompilerMember(token, "getText").getText(sourceFile)], fixIdDeleteImports, Diagnostics.Delete_all_unused_imports)];
            }
        }
        if (testCompilerLayout(token.parent, isObjectBindingPattern) || testCompilerLayout(token.parent, isArrayBindingPattern)) {
            if (isParameter(token.parent.parent)) {
                const elements = token.parent.elements;
                const diagnostic: [
                    DiagnosticMessage,
                    string
                ] = [
                    elements.length > 1 ? Diagnostics.Remove_unused_declarations_for_Colon_0 : Diagnostics.Remove_unused_declaration_for_Colon_0,
                    map(elements, e => requireCompilerMember(e, "getText").getText(sourceFile)).join(", "),
                ];
                return [
                    createDeleteFix(textChanges.ChangeTracker.with(context, t => deleteDestructuringElements(t, sourceFile, (checkedCompilerLayout(token.parent, isNodeLayout_bd1908686ab2))!)), diagnostic),
                ];
            }
            return [
                createDeleteFix(textChanges.ChangeTracker.with(context, t => deleteDestructuring(context, t, sourceFile, (checkedCompilerLayout(token.parent, isNodeLayout_bd1908686ab2))!)), Diagnostics.Remove_unused_destructuring_declaration),
            ];
        }
        if (canDeleteEntireVariableStatement(sourceFile, token)) {
            return [
                createDeleteFix(textChanges.ChangeTracker.with(context, t => deleteEntireVariableStatement(t, sourceFile, (checkedCompilerLayout(token.parent, checked_isVariableDeclarationList))!)), Diagnostics.Remove_variable_statement),
            ];
        }
        if (isIdentifier(token) && testCompilerLayout(token.parent, isFunctionDeclaration)) {
            return [createDeleteFix(textChanges.ChangeTracker.with(context, t => deleteFunctionLikeDeclaration(t, sourceFile, (checkedCompilerLayout(token.parent, checked_isFunctionLikeDeclaration))!)), [Diagnostics.Remove_unused_declaration_for_Colon_0, requireCompilerMember(token, "getText").getText(sourceFile)])];
        }
        const result: CodeFixAction[] = [];
        if (token.kind === SyntaxKind.InferKeyword) {
            const changes = textChanges.ChangeTracker.with(context, t => changeInferToUnknown(t, sourceFile, token));
            const name = cast(token.parent, isInferTypeNode).typeParameter.name.text;
            result.push(createCodeFixAction(fixName, changes, [Diagnostics.Replace_infer_0_with_unknown, (name)!], fixIdInfer, Diagnostics.Replace_all_unused_infer_with_unknown));
        }
        else {
            const deletion = textChanges.ChangeTracker.with(context, t => tryDeleteDeclaration(sourceFile, token, t, checker, sourceFiles, program, cancellationToken, /*isFixAll*/ false));
            if (deletion.length) {
                const name = testCompilerLayout(token.parent, isComputedPropertyName) ? token.parent : token;
                result.push(createDeleteFix(deletion, [Diagnostics.Remove_unused_declaration_for_Colon_0, requireCompilerMember(name, "getText").getText(sourceFile)]));
            }
        }
        const prefix = textChanges.ChangeTracker.with(context, t => tryPrefixDeclaration(t, errorCode, sourceFile, token));
        if (prefix.length) {
            result.push(createCodeFixAction(fixName, prefix, [Diagnostics.Prefix_0_with_an_underscore, requireCompilerMember(token, "getText").getText(sourceFile)], fixIdPrefix, Diagnostics.Prefix_all_unused_declarations_with_where_possible));
        }
        return result;
    },
    fixIds: [fixIdPrefix, fixIdDelete, fixIdDeleteImports, fixIdInfer],
    getAllCodeActions: context => {
        const { sourceFile, program, cancellationToken } = context;
        const checker = program.getTypeChecker();
        const sourceFiles = program.getSourceFiles();
        return codeFixAll(context, errorCodes, (changes, diag) => {
            const token = getTokenAtPosition(sourceFile, diag.start);
            switch (context.fixId) {
                case fixIdPrefix:
                    tryPrefixDeclaration(changes, diag.code, sourceFile, token);
                    break;
                case fixIdDeleteImports: {
                    const importDecl = tryGetFullImport(token);
                    if (importDecl) {
                        changes.delete(sourceFile, importDecl);
                    }
                    else if (isImport(token)) {
                        tryDeleteDeclaration(sourceFile, token, changes, checker, sourceFiles, program, cancellationToken, /*isFixAll*/ true);
                    }
                    break;
                }
                case fixIdDelete: {
                    if (token.kind === SyntaxKind.InferKeyword || isImport(token)) {
                        break; // Can't delete
                    }
                    else if (isJSDocTemplateTag(token)) {
                        changes.delete(sourceFile, token);
                    }
                    else if (token.kind === SyntaxKind.LessThanToken) {
                        deleteTypeParameters(changes, sourceFile, token);
                    }
                    else if (testCompilerLayout(token.parent, isObjectBindingPattern)) {
                        if (token.parent.parent.initializer) {
                            break;
                        }
                        else if (!isParameter(token.parent.parent) || isNotProvidedArguments(token.parent.parent, checker, sourceFiles)) {
                            changes.delete(sourceFile, token.parent.parent);
                        }
                    }
                    else if (testCompilerLayout((token.parent)!.parent, isArrayBindingPattern) && checkedCompilerLayout(((token.parent)!.parent)!.parent!, checked_isVariableDeclaration).initializer) {
                        break;
                    }
                    else if (canDeleteEntireVariableStatement(sourceFile, token)) {
                        deleteEntireVariableStatement(changes, sourceFile, (checkedCompilerLayout(token.parent, checked_isVariableDeclarationList))!);
                    }
                    else if (isIdentifier(token) && testCompilerLayout(token.parent, isFunctionDeclaration)) {
                        deleteFunctionLikeDeclaration(changes, sourceFile, token.parent);
                    }
                    else {
                        tryDeleteDeclaration(sourceFile, token, changes, checker, sourceFiles, program, cancellationToken, /*isFixAll*/ true);
                    }
                    break;
                }
                case fixIdInfer:
                    if (token.kind === SyntaxKind.InferKeyword) {
                        changeInferToUnknown(changes, sourceFile, token);
                    }
                    break;
                default:
                    Debug.fail(JSON.stringify(context.fixId));
            }
        });
    },
});
function changeInferToUnknown(changes: textChanges.ChangeTracker, sourceFile: SourceFile, token: Node): void {
    changes.replaceNode(sourceFile, (token.parent)!, factory.createKeywordTypeNode(SyntaxKind.UnknownKeyword));
}
function createDeleteFix(changes: FileTextChanges[], diag: DiagnosticOrDiagnosticAndArguments): CodeFixAction {
    return createCodeFixAction(fixName, changes, diag, fixIdDelete, Diagnostics.Delete_all_unused_declarations);
}
function deleteTypeParameters(changes: textChanges.ChangeTracker, sourceFile: SourceFile, token: Node): void {
    changes.delete(sourceFile, Debug.checkDefined(cast(token.parent, isDeclarationWithTypeParameterChildren).typeParameters, "The type parameter to delete should exist"));
}
function isImport(token: Node) {
    return token.kind === SyntaxKind.ImportKeyword
        || token.kind === SyntaxKind.Identifier && ((token.parent)!.kind === SyntaxKind.ImportSpecifier || (token.parent)!.kind === SyntaxKind.ImportClause);
}
/** Sometimes the diagnostic span is an entire ImportDeclaration, so we should remove the whole thing. */
function tryGetFullImport(token: Node): ImportDeclaration | undefined {
    return token.kind === SyntaxKind.ImportKeyword ? tryCast(token.parent, isImportDeclaration) : undefined;
}
function canDeleteEntireVariableStatement(sourceFile: SourceFile, token: Node): boolean {
    return testCompilerLayout(token.parent, isVariableDeclarationList) && first(requireCompilerMember(token.parent, "getChildren").getChildren(sourceFile)) === token;
}
function deleteEntireVariableStatement(changes: textChanges.ChangeTracker, sourceFile: SourceFile, node: VariableDeclarationList) {
    changes.delete(sourceFile, node.parent.kind === SyntaxKind.VariableStatement ? node.parent : node);
}
function deleteDestructuringElements(changes: textChanges.ChangeTracker, sourceFile: SourceFile, node: ObjectBindingPattern | ArrayBindingPattern) {
    forEach(node.elements, n => changes.delete(sourceFile, n));
}
function deleteDestructuring(context: CodeFixContext, changes: textChanges.ChangeTracker, sourceFile: SourceFile, { parent }: ObjectBindingPattern | ArrayBindingPattern) {
    if (isVariableDeclaration(parent) && parent.initializer && isCallLikeExpression(parent.initializer)) {
        if (isVariableDeclarationList(parent.parent) && length(parent.parent.declarations) > 1) {
            const varStatement = parent.parent.parent;
            const pos = requireCompilerMember(varStatement, "getStart").getStart(sourceFile);
            const end = varStatement.end;
            changes.delete(sourceFile, parent);
            changes.insertNodeAt(sourceFile, end, parent.initializer, {
                prefix: getNewLineOrDefaultFromHost(context.host, context.formatContext.options) + sourceFile.text.slice(getPrecedingNonSpaceCharacterPosition(sourceFile.text, pos - 1), pos),
                suffix: probablyUsesSemicolons(sourceFile) ? ";" : "",
            });
        }
        else {
            changes.replaceNode(sourceFile, parent.parent, parent.initializer);
        }
    }
    else {
        changes.delete(sourceFile, parent);
    }
}
function tryPrefixDeclaration(changes: textChanges.ChangeTracker, errorCode: number, sourceFile: SourceFile, token: Node): void {
    // Don't offer to prefix a property.
    if (errorCode === Diagnostics.Property_0_is_declared_but_its_value_is_never_read.code)
        return;
    if (token.kind === SyntaxKind.InferKeyword) {
        token = cast(token.parent, isInferTypeNode).typeParameter.name;
    }
    if (isIdentifier(token) && canPrefix(token)) {
        changes.replaceNode(sourceFile, token, factory.createIdentifier(`_${token.text}`));
        if (testCompilerLayout(token.parent, isParameter)) {
            getJSDocParameterTags(token.parent).forEach(tag => {
                if (isIdentifier(tag.name)) {
                    changes.replaceNode(sourceFile, tag.name, factory.createIdentifier(`_${tag.name.text}`));
                }
            });
        }
    }
}
function canPrefix(token: Identifier): boolean {
    switch ((token.parent)!.kind) {
        case SyntaxKind.Parameter:
        case SyntaxKind.TypeParameter:
            return true;
        case SyntaxKind.VariableDeclaration: {
            const varDecl = checkedCompilerLayout(token.parent, checked_isVariableDeclaration);
            switch ((varDecl)!.parent.parent.kind) {
                case SyntaxKind.ForOfStatement:
                case SyntaxKind.ForInStatement:
                    return true;
            }
        }
    }
    return false;
}
function tryDeleteDeclaration(sourceFile: SourceFile, token: Node, changes: textChanges.ChangeTracker, checker: TypeChecker, sourceFiles: readonly SourceFile[], program: Program, cancellationToken: CancellationToken, isFixAll: boolean) {
    tryDeleteDeclarationWorker(token, changes, sourceFile, checker, sourceFiles, program, cancellationToken, isFixAll);
    if (isIdentifier(token)) {
        FindAllReferences.Core.eachSymbolReferenceInFile(token, checker, sourceFile, (ref: Node) => {
            if (testCompilerLayout(ref.parent, isPropertyAccessExpression) && ref.parent.name === ref)
                ref = ref.parent;
            if (!isFixAll && mayDeleteExpression(ref)) {
                changes.delete(sourceFile, ((ref.parent)!.parent)!);
            }
        });
    }
}
function tryDeleteDeclarationWorker(token: Node, changes: textChanges.ChangeTracker, sourceFile: SourceFile, checker: TypeChecker, sourceFiles: readonly SourceFile[], program: Program, cancellationToken: CancellationToken, isFixAll: boolean): void {
    const { parent } = token;
    if (testCompilerLayout(parent, isParameter)) {
        tryDeleteParameter(changes, sourceFile, parent, checker, sourceFiles, program, cancellationToken, isFixAll);
    }
    else if (!(isFixAll && isIdentifier(token) && FindAllReferences.Core.isSymbolReferencedInFile(token, checker, sourceFile))) {
        const node = testCompilerLayout(parent, isImportClause) ? token : testCompilerLayout(parent, isComputedPropertyName) ? parent.parent : parent;
        Debug.assert(node !== sourceFile, "should not delete whole source file");
        changes.delete(sourceFile, (node)!);
    }
}
function tryDeleteParameter(changes: textChanges.ChangeTracker, sourceFile: SourceFile, parameter: ParameterDeclaration, checker: TypeChecker, sourceFiles: readonly SourceFile[], program: Program, cancellationToken: CancellationToken, isFixAll = false): void {
    if (mayDeleteParameter(checker, sourceFile, parameter, sourceFiles, program, cancellationToken, isFixAll)) {
        if (parameter.modifiers && parameter.modifiers.length > 0 &&
            (!isIdentifier(parameter.name) || FindAllReferences.Core.isSymbolReferencedInFile(parameter.name, checker, sourceFile))) {
            for (const modifier of parameter.modifiers) {
                if (isModifier(modifier)) {
                    changes.deleteModifier(sourceFile, modifier);
                }
            }
        }
        else if (!parameter.initializer && isNotProvidedArguments(parameter, checker, sourceFiles)) {
            changes.delete(sourceFile, parameter);
        }
    }
}
function isNotProvidedArguments(parameter: ParameterDeclaration, checker: TypeChecker, sourceFiles: readonly SourceFile[]) {
    const index = parameter.parent.parameters.indexOf(parameter);
    // Just in case the call didn't provide enough arguments.
    return !FindAllReferences.Core.someSignatureUsage(parameter.parent, sourceFiles, checker, (_, call) => !call || call.arguments.length > index);
}
function mayDeleteParameter(checker: TypeChecker, sourceFile: SourceFile, parameter: ParameterDeclaration, sourceFiles: readonly SourceFile[], program: Program, cancellationToken: CancellationToken, isFixAll: boolean): boolean {
    const { parent } = parameter;
    switch (parent.kind) {
        case SyntaxKind.MethodDeclaration:
        case SyntaxKind.Constructor:
            const index = parent.parameters.indexOf(parameter);
            const referent = isMethodDeclaration(parent) ? parent.name : parent;
            const entries = FindAllReferences.Core.getReferencedSymbolsForNode(parent.pos, referent, program, sourceFiles, cancellationToken);
            if (entries) {
                for (const entry of entries) {
                    for (const reference of entry.references) {
                        if (reference.kind === FindAllReferences.EntryKind.Node) {
                            // argument in super(...)
                            const isSuperCall = isSuperKeyword(reference.node)
                                && testCompilerLayout(reference.node.parent, isCallExpression)
                                && reference.node.parent.arguments.length > index;
                            // argument in super.m(...)
                            const isSuperMethodCall = testCompilerLayout(reference.node.parent, isPropertyAccessExpression) && isSuperKeyword(reference.node.parent.expression)
                                && testCompilerLayout(reference.node.parent.parent, isCallExpression)
                                && reference.node.parent.parent.arguments.length > index;
                            // parameter in overridden or overriding method
                            const isOverriddenMethod = (testCompilerLayout(reference.node.parent, isMethodDeclaration) || testCompilerLayout(reference.node.parent, isMethodSignature))
                                && reference.node.parent !== parameter.parent
                                && reference.node.parent.parameters.length > index;
                            if (isSuperCall || isSuperMethodCall || isOverriddenMethod)
                                return false;
                        }
                    }
                }
            }
            return true;
        case SyntaxKind.FunctionDeclaration: {
            if (parent.name && isCallbackLike(checker, sourceFile, parent.name)) {
                return isLastParameter(parent, parameter, isFixAll);
            }
            return true;
        }
        case SyntaxKind.FunctionExpression:
        case SyntaxKind.ArrowFunction:
            // Can't remove a non-last parameter in a callback. Can remove a parameter in code-fix-all if future parameters are also unused.
            return isLastParameter(parent, parameter, isFixAll);
        case SyntaxKind.SetAccessor:
            // Setter must have a parameter
            return false;
        case SyntaxKind.GetAccessor:
            // Getter cannot have parameters
            return true;
        default:
            return Debug.failBadSyntaxKind(parent);
    }
}
function isCallbackLike(checker: TypeChecker, sourceFile: SourceFile, name: Identifier): boolean {
    return !!FindAllReferences.Core.eachSymbolReferenceInFile(name, checker, sourceFile, reference => isIdentifier(reference) && testCompilerLayout(reference.parent, isCallExpression) && reference.parent.arguments.includes(reference));
}
function isLastParameter(func: FunctionLikeDeclaration, parameter: ParameterDeclaration, isFixAll: boolean): boolean {
    const parameters = func.parameters;
    const index = parameters.indexOf(parameter);
    Debug.assert(index !== -1, "The parameter should already be in the list");
    return isFixAll ?
        parameters.slice(index + 1).every(p => isIdentifier(p.name) && !(p.symbol)!.isReferenced) :
        index === parameters.length - 1;
}
function mayDeleteExpression(node: Node) {
    return ((testCompilerLayout(node.parent, isBinaryExpression) && node.parent.left === node) ||
        ((testCompilerLayout(node.parent, isPostfixUnaryExpression) || testCompilerLayout(node.parent, isPrefixUnaryExpression)) && node.parent.operand === node)) && testCompilerLayout(node.parent.parent, isExpressionStatement);
}
function deleteFunctionLikeDeclaration(changes: textChanges.ChangeTracker, sourceFile: SourceFile, node: FunctionLikeDeclaration) {
    const declarations = (node.symbol)!.declarations;
    if (declarations) {
        for (const declaration of declarations) {
            changes.delete(sourceFile, declaration);
        }
    }
}
