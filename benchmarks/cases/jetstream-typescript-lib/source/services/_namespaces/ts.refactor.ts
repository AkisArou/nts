// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/_namespaces/ts.refactor.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
/* Generated file to emulate the ts.refactor namespace. */
export * from "../refactorProvider.ts";
export * from "../refactors/convertExport.ts";
export * from "../refactors/convertImport.ts";
export * from "../refactors/extractType.ts";
export * from "../refactors/helpers.ts";
export * from "../refactors/inlineVariable.ts";
export * from "../refactors/moveToNewFile.ts";
export * from "../refactors/moveToFile.ts";
import * as addOrRemoveBracesToArrowFunction from "./ts.refactor.addOrRemoveBracesToArrowFunction.ts";
export { addOrRemoveBracesToArrowFunction };
import * as convertArrowFunctionOrFunctionExpression from "./ts.refactor.convertArrowFunctionOrFunctionExpression.ts";
export { convertArrowFunctionOrFunctionExpression };
import * as convertParamsToDestructuredObject from "./ts.refactor.convertParamsToDestructuredObject.ts";
export { convertParamsToDestructuredObject };
import * as convertStringOrTemplateLiteral from "./ts.refactor.convertStringOrTemplateLiteral.ts";
export { convertStringOrTemplateLiteral };
import * as convertToOptionalChainExpression from "./ts.refactor.convertToOptionalChainExpression.ts";
export { convertToOptionalChainExpression };
import * as extractSymbol from "./ts.refactor.extractSymbol.ts";
export { extractSymbol };
import * as generateGetAccessorAndSetAccessor from "./ts.refactor.generateGetAccessorAndSetAccessor.ts";
export { generateGetAccessorAndSetAccessor };
import * as inferFunctionReturnType from "./ts.refactor.inferFunctionReturnType.ts";
export { inferFunctionReturnType };
