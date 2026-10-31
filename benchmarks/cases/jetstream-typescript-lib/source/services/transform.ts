// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/transform.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { present } from "../checked.ts";
import { type CompilerOptions, concatenate, type DiagnosticWithLocation, factory, fixupCompilerOptions, isArray, type Node, type TransformationResult, type TransformerFactory, transformNodes } from "./_namespaces/ts.ts";
/**
 * Transform one or more nodes using the supplied transformers.
 * @param source A single `Node` or an array of `Node` objects.
 * @param transformers An array of `TransformerFactory` callbacks used to process the transformation.
 * @param compilerOptions Optional compiler options.
 */
export function transform<T extends Node>(source: T | T[], transformers: TransformerFactory<T>[], compilerOptions?: CompilerOptions): TransformationResult<T> {
    const diagnostics: DiagnosticWithLocation[] = [];
    compilerOptions = fixupCompilerOptions((compilerOptions)!, diagnostics); // TODO: GH#18217
    const nodes = isArray(source) ? source : [source];
    const result = transformNodes(/*resolver*/ undefined, /*host*/ undefined, factory, compilerOptions, nodes, transformers, /*allowDtsFiles*/ true);
    result.diagnostics = concatenate(result.diagnostics, diagnostics);
    return result;
}
