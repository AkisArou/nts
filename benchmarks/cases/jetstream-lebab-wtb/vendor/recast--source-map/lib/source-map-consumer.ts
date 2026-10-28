import type { ArraySet as ArraySetLayout } from "./array-set.ts";
import type { MappingFields, DeflatedMapping } from "./util.ts";
import type { Generator } from "./source-map-generator.ts";
import { sourceMapString, sourceMapArray, sourceMapProperty, sourceMapMethod, sourceMapLess, sourceMapAddNumber, type Coordinate, type Consumer, type OriginalLineQuery, type OriginalQuery, type GeneratedQuery, type OriginalPosition, type GeneratedPosition, type ObservedMapping } from "./sourceMapTypes.ts";
export type SourceMapConsumer = InstanceType<ReturnType<typeof load>["SourceMapConsumer"]>;
// Exact module body from JetStream 3.0 ./node_modules/recast/node_modules/source-map/lib/source-map-consumer.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord, exportsReady, record, runtimeMethod, runtimeCall} from "../../../webpack.ts";
import {load as load0} from "./util.ts";
import {load as load1} from "./binary-search.ts";
import {load as load2} from "./array-set.ts";
import {load as load3} from "./base64-vlq.ts";
import {load as load4} from "./quick-sort.ts";

let cache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for recast--source-map/lib/source-map-consumer.js");
  return value;
 }
 return initialize();
}
function isExport(value: unknown): value is ReturnType<typeof initialize> {
 return isRecord(value) && typeof value.SourceMapConsumer === "function" && typeof value.BasicSourceMapConsumer === "function" && typeof value.IndexedSourceMapConsumer === "function";
}
function initialize() {
const exports: { "SourceMapConsumer"?: typeof SourceMapConsumer; "BasicSourceMapConsumer"?: typeof BasicSourceMapConsumer; "IndexedSourceMapConsumer"?: typeof IndexedSourceMapConsumer; } = {};
let module = {exports};
cache = module;


/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */

var util = load0();
var binarySearch = load1();
var ArraySet = (load2().ArraySet);
var base64VLQ = load3();
var quickSort = (load4().quickSort);
interface Section { generatedOffset: {generatedLine: number | string; generatedColumn: number | string}; consumer: SourceMapConsumer; generatedLine?: Coordinate; generatedColumn?: Coordinate; }
function allocatedBasicConsumer(value: unknown): BasicSourceMapConsumer { if (!(value instanceof BasicSourceMapConsumer)) throw new TypeError("Expected original BasicSourceMapConsumer prototype"); return value; }

class SourceMapConsumer {
  declare _version: number;
  declare _sources: ArraySetLayout;
  declare _names: ArraySetLayout;
  declare _mappings: unknown;
  declare _sourceMapURL: string | null | undefined;
  declare sourceRoot: unknown;
  declare file: unknown;
  declare sourcesContent: unknown;
  declare sources: string[];
  declare __generatedMappings: DeflatedMapping[] | null;
  declare __originalMappings: DeflatedMapping[] | null;
  declare _generatedMappings: DeflatedMapping[];
  declare _originalMappings: DeflatedMapping[];
  declare _charIsMappingSeparator: (text: unknown, index: number) => boolean;
  declare _parseMappings: (text: unknown, sourceRoot: unknown) => void;
  declare eachMapping: Consumer["eachMapping"];
  declare allGeneratedPositionsFor: Consumer["allGeneratedPositionsFor"];
  declare originalPositionFor: Consumer["originalPositionFor"];
  declare generatedPositionFor: Consumer["generatedPositionFor"];
  declare sourceContentFor: Consumer["sourceContentFor"];
  declare hasContentsOfAllSources: Consumer["hasContentsOfAllSources"];
  declare _findSourceIndex: ((source: string) => number) | undefined;
  declare _findMapping: ((needle: MappingFields, mappings: DeflatedMapping[], lineName: "generatedLine" | "originalLine", columnName: "generatedColumn" | "originalColumn", comparator: (left: MappingFields, right: MappingFields, onlyPosition?: boolean) => number, bias?: number) => number) | undefined;

  declare static fromSourceMap: (map: Generator, url?: string | null) => BasicSourceMapConsumer;
  declare static GENERATED_ORDER: number;
  declare static ORIGINAL_ORDER: number;
  declare static GREATEST_LOWER_BOUND: number;
  declare static LEAST_UPPER_BOUND: number;
  constructor(aSourceMap: unknown, aSourceMapURL?: string | null) {
  var sourceMap = aSourceMap;
  if (typeof aSourceMap === 'string') {
    sourceMap = util.parseSourceMapInput(aSourceMap);
  }

  return sourceMapProperty(sourceMap, "sections") != null
    ? new IndexedSourceMapConsumer(sourceMap, aSourceMapURL)
    : new BasicSourceMapConsumer(sourceMap, aSourceMapURL);
}
}

SourceMapConsumer.fromSourceMap = function(aSourceMap: Generator, aSourceMapURL?: string | null) {
  return BasicSourceMapConsumer.fromSourceMap(aSourceMap, aSourceMapURL);
}

/**
 * The version of the source mapping spec that we are consuming.
 */
SourceMapConsumer.prototype._version = 3;

// `__generatedMappings` and `__originalMappings` are arrays that hold the
// parsed mapping coordinates from the source map's "mappings" attribute. They
// are lazily instantiated, accessed via the `_generatedMappings` and
// `_originalMappings` getters respectively, and we only parse the mappings
// and create these arrays once queried for a source location. We jump through
// these hoops because there can be many thousands of mappings, and parsing
// them is expensive, so we only want to do it if we must.
//
// Each object in the arrays is of the form:
//
//     {
//       generatedLine: The line number in the generated code,
//       generatedColumn: The column number in the generated code,
//       source: The path to the original source file that generated this
//               chunk of code,
//       originalLine: The line number in the original source that
//                     corresponds to this chunk of generated code,
//       originalColumn: The column number in the original source that
//                       corresponds to this chunk of generated code,
//       name: The name of the original symbol which generated this chunk of
//             code.
//     }
//
// All properties except for `generatedLine` and `generatedColumn` can be
// `null`.
//
// `_generatedMappings` is ordered by the generated positions.
//
// `_originalMappings` is ordered by the original positions.

SourceMapConsumer.prototype.__generatedMappings = null;
Object.defineProperty(SourceMapConsumer.prototype, '_generatedMappings', {
  configurable: true,
  enumerable: true,
  get: function (this: SourceMapConsumer) {
    if (!this.__generatedMappings) {
      this._parseMappings(this._mappings, this.sourceRoot);
    }

    return this.__generatedMappings;
  }
});

SourceMapConsumer.prototype.__originalMappings = null;
Object.defineProperty(SourceMapConsumer.prototype, '_originalMappings', {
  configurable: true,
  enumerable: true,
  get: function (this: SourceMapConsumer) {
    if (!this.__originalMappings) {
      this._parseMappings(this._mappings, this.sourceRoot);
    }

    return this.__originalMappings;
  }
});

SourceMapConsumer.prototype._charIsMappingSeparator =
  function SourceMapConsumer_charIsMappingSeparator(this: SourceMapConsumer, aStr: unknown, index: number) {
    var c = runtimeMethod(aStr, "charAt", [index]);
    return c === ";" || c === ",";
  };

/**
 * Parse the mappings in a string in to a data structure which we can easily
 * query (the ordered arrays in the `this.__generatedMappings` and
 * `this.__originalMappings` properties).
 */
SourceMapConsumer.prototype._parseMappings =
  function SourceMapConsumer_parseMappings(this: SourceMapConsumer, aStr: unknown, aSourceRoot: unknown) {
    throw new Error("Subclasses must implement _parseMappings");
  };

SourceMapConsumer.GENERATED_ORDER = 1;
SourceMapConsumer.ORIGINAL_ORDER = 2;

SourceMapConsumer.GREATEST_LOWER_BOUND = 1;
SourceMapConsumer.LEAST_UPPER_BOUND = 2;

/**
 * Iterate over each mapping between an original source/line/column and a
 * generated line/column in this source map.
 *
 * @param Function aCallback
 *        The function that is called with each mapping.
 * @param Object aContext
 *        Optional. If specified, this object will be the value of `this` every
 *        time that `aCallback` is called.
 * @param aOrder
 *        Either `SourceMapConsumer.GENERATED_ORDER` or
 *        `SourceMapConsumer.ORIGINAL_ORDER`. Specifies whether you want to
 *        iterate over the mappings sorted by the generated file's line/column
 *        order or the original's source/line/column order, respectively. Defaults to
 *        `SourceMapConsumer.GENERATED_ORDER`.
 */
SourceMapConsumer.prototype.eachMapping =
  function SourceMapConsumer_eachMapping(this: SourceMapConsumer, aCallback: (mapping: ObservedMapping, index: number, mappings: ObservedMapping[]) => void, aContext?: unknown, aOrder?: number) {
    var context = aContext || null;
    var order = aOrder || SourceMapConsumer.GENERATED_ORDER;

    var mappings: DeflatedMapping[];
    switch (order) {
    case SourceMapConsumer.GENERATED_ORDER:
      mappings = this._generatedMappings;
      break;
    case SourceMapConsumer.ORIGINAL_ORDER:
      mappings = this._originalMappings;
      break;
    default:
      throw new Error("Unknown order of iteration.");
    }

    var sourceRoot = this.sourceRoot;
    mappings.map(function (this: SourceMapConsumer, mapping) {
      var source = mapping.source === null ? null : this._sources.at(mapping.source!);
      source = sourceMapString(runtimeMethod(util, "computeSourceURL", [sourceRoot, source, this._sourceMapURL]));
      return {
        source: source,
        generatedLine: mapping.generatedLine,
        generatedColumn: mapping.generatedColumn,
        originalLine: mapping.originalLine,
        originalColumn: mapping.originalColumn,
        name: mapping.name === null ? null : this._names.at(mapping.name!)
      };
    }, this).forEach(aCallback, context);
  };

/**
 * Returns all generated line and column information for the original source,
 * line, and column provided. If no column is provided, returns all mappings
 * corresponding to a either the line we are searching for or the next
 * closest line that has any mappings. Otherwise, returns all mappings
 * corresponding to the given line and either the column we are searching for
 * or the next closest column that has any offsets.
 *
 * The only argument is an object with the following properties:
 *
 *   - source: The filename of the original source.
 *   - line: The line number in the original source.  The line number is 1-based.
 *   - column: Optional. the column number in the original source.
 *    The column number is 0-based.
 *
 * and an array of objects is returned, each with the following properties:
 *
 *   - line: The line number in the generated source, or null.  The
 *    line number is 1-based.
 *   - column: The column number in the generated source, or null.
 *    The column number is 0-based.
 */
SourceMapConsumer.prototype.allGeneratedPositionsFor =
  function SourceMapConsumer_allGeneratedPositionsFor(this: SourceMapConsumer, aArgs: OriginalLineQuery): GeneratedPosition[] {
    var line = util.getArg(aArgs, 'line');

    // When there is no exact match, BasicSourceMapConsumer.prototype._findMapping
    // returns the index of the closest mapping less than the needle. By
    // setting needle.originalColumn to 0, we thus find the last mapping for
    // the given line, provided such a mapping exists.
    var needle: MappingFields = {
      source: util.getArg(aArgs, 'source'),
      originalLine: line,
      originalColumn: util.getArg(aArgs, 'column', 0)
    };

    needle.source = this._findSourceIndex!(sourceMapString(needle.source));
    if (Number(needle.source) < 0) {
      return [];
    }

    var mappings: GeneratedPosition[] = [];

    var index = this._findMapping!(needle,
                                  this._originalMappings,
                                  "originalLine",
                                  "originalColumn",
                                  util.compareByOriginalPositions,
                                  binarySearch.LEAST_UPPER_BOUND);
    if (index >= 0) {
      var mapping = this._originalMappings[index];

      if (aArgs.column === undefined) {
        var originalLine = mapping.originalLine;

        // Iterate until either we run out of mappings, or we run into
        // a mapping for a different line than the one we found. Since
        // mappings are sorted, this is guaranteed to find all mappings for
        // the line we found.
        while (mapping && mapping.originalLine === originalLine) {
          mappings.push({
            line: util.getArg(mapping, 'generatedLine', null),
            column: util.getArg(mapping, 'generatedColumn', null),
            lastColumn: util.getArg(mapping, 'lastGeneratedColumn', null)
          });

          mapping = this._originalMappings[++index];
        }
      } else {
        var originalColumn = mapping.originalColumn;

        // Iterate until either we run out of mappings, or we run into
        // a mapping for a different line than the one we were searching for.
        // Since mappings are sorted, this is guaranteed to find all mappings for
        // the line we are searching for.
        while (mapping &&
               mapping.originalLine === line &&
               mapping.originalColumn == originalColumn) {
          mappings.push({
            line: util.getArg(mapping, 'generatedLine', null),
            column: util.getArg(mapping, 'generatedColumn', null),
            lastColumn: util.getArg(mapping, 'lastGeneratedColumn', null)
          });

          mapping = this._originalMappings[++index];
        }
      }
    }

    return mappings;
  };

exports.SourceMapConsumer = SourceMapConsumer;

/**
 * A BasicSourceMapConsumer instance represents a parsed source map which we can
 * query for information about the original file positions by giving it a file
 * position in the generated source.
 *
 * The first parameter is the raw source map (either as a JSON string, or
 * already parsed to an object). According to the spec, source maps have the
 * following attributes:
 *
 *   - version: Which version of the source map spec this map is following.
 *   - sources: An array of URLs to the original source files.
 *   - names: An array of identifiers which can be referrenced by individual mappings.
 *   - sourceRoot: Optional. The URL root from which all sources are relative.
 *   - sourcesContent: Optional. An array of contents of the original source files.
 *   - mappings: A string of base64 VLQs which contain the actual mappings.
 *   - file: Optional. The generated file this source map is associated with.
 *
 * Here is an example source map, taken from the source map spec[0]:
 *
 *     {
 *       version : 3,
 *       file: "out.js",
 *       sourceRoot : "",
 *       sources: ["foo.js", "bar.js"],
 *       names: ["src", "maps", "are", "fun"],
 *       mappings: "AA,AB;;ABCDE;"
 *     }
 *
 * The second parameter, if given, is a string whose value is the URL
 * at which the source map was found.  This URL is used to compute the
 * sources array.
 *
 * [0]: https://docs.google.com/document/d/1U1RGAehQwRypUTovF1KRlpiOFze0b-_2gc6fAH0KY0k/edit?pli=1#
 */
class BasicSourceMapConsumer {
  declare _version: number;
  declare _sources: ArraySetLayout;
  declare _names: ArraySetLayout;
  declare _mappings: unknown;
  declare _sourceMapURL: string | null | undefined;
  declare sourceRoot: unknown;
  declare file: unknown;
  declare sourcesContent: unknown;
  declare sources: string[];
  declare __generatedMappings: DeflatedMapping[] | null;
  declare __originalMappings: DeflatedMapping[] | null;
  declare _generatedMappings: DeflatedMapping[];
  declare _originalMappings: DeflatedMapping[];
  declare _charIsMappingSeparator: (text: unknown, index: number) => boolean;
  declare _parseMappings: (text: unknown, sourceRoot: unknown) => void;
  declare eachMapping: Consumer["eachMapping"];
  declare allGeneratedPositionsFor: Consumer["allGeneratedPositionsFor"];
  declare originalPositionFor: Consumer["originalPositionFor"];
  declare generatedPositionFor: Consumer["generatedPositionFor"];
  declare sourceContentFor: Consumer["sourceContentFor"];
  declare hasContentsOfAllSources: Consumer["hasContentsOfAllSources"];
  declare _findSourceIndex: ((source: string) => number) | undefined;
  declare _findMapping: ((needle: MappingFields, mappings: DeflatedMapping[], lineName: "generatedLine" | "originalLine", columnName: "generatedColumn" | "originalColumn", comparator: (left: MappingFields, right: MappingFields, onlyPosition?: boolean) => number, bias?: number) => number) | undefined;

  declare _absoluteSources: string[];
  declare consumer: typeof SourceMapConsumer;
  declare computeColumnSpans: () => void;
  declare static fromSourceMap: (map: Generator, url?: string | null) => BasicSourceMapConsumer;
  constructor(aSourceMap: unknown, aSourceMapURL?: string | null) {
  var sourceMap = aSourceMap;
  if (typeof aSourceMap === 'string') {
    sourceMap = util.parseSourceMapInput(aSourceMap);
  }

  var version = util.getArg(sourceMap, 'version');
  var sourcesInput = util.getArg(sourceMap, 'sources');
  // Sass 3.3 leaves out the 'names' array, so we deviate from the spec (which
  // requires the array) to play nice here.
  var names = util.getArg(sourceMap, 'names', []);
  var sourceRoot = util.getArg(sourceMap, 'sourceRoot', null);
  var sourcesContent = util.getArg(sourceMap, 'sourcesContent', null);
  var mappings = util.getArg(sourceMap, 'mappings');
  var file = util.getArg(sourceMap, 'file', null);

  // Once again, Sass deviates from the spec and supplies the version as a
  // string rather than a number, so we use loose equality checking here.
  if (version != this._version) {
    throw new Error('Unsupported version: ' + version);
  }

  if (sourceRoot) {
    sourceRoot = runtimeMethod(util, "normalize", [sourceRoot]);
  }

  var sources = sourceMapArray(sourcesInput)
    .map(String)
    // Some source maps produce relative source paths like "./foo.js" instead of
    // "foo.js".  Normalize these first so that future comparisons will succeed.
    // See bugzil.la/1090768.
    .map(util.normalize)
    // Always ensure that absolute sources are internally stored relative to
    // the source root, if the source root is absolute. Not doing this would
    // be particularly problematic when the source root is a prefix of the
    // source (valid, but why??). See github issue #199 and bugzil.la/1188982.
    .map(function (source) {
      return sourceRoot && runtimeMethod(util, "isAbsolute", [sourceRoot]) && util.isAbsolute(source)
        ? sourceMapString(runtimeMethod(util, "relative", [sourceRoot, source]))
        : source;
    });

  // Pass `true` below to allow duplicate names and sources. While source maps
  // are intended to be compressed and deduplicated, the TypeScript compiler
  // sometimes generates source maps with duplicates in them. See Github issue
  // #72 and bugzil.la/889492.
  this._names = ArraySet.fromArray(sourceMapArray(names).map(String), true);
  this._sources = ArraySet.fromArray(sources, true);

  this._absoluteSources = this._sources.toArray().map(function (s) {
    return sourceMapString(runtimeMethod(util, "computeSourceURL", [sourceRoot, s, aSourceMapURL]));
  });

  this.sourceRoot = sourceRoot;
  this.sourcesContent = sourcesContent;
  this._mappings = mappings;
  this._sourceMapURL = aSourceMapURL;
  this.file = file;
}
}

Object.setPrototypeOf(BasicSourceMapConsumer.prototype, SourceMapConsumer.prototype);
const constructorKey: string = "constructor";
delete record(BasicSourceMapConsumer.prototype)[constructorKey];
BasicSourceMapConsumer.prototype.consumer = SourceMapConsumer;

/**
 * Utility function to find the index of a source.  Returns -1 if not
 * found.
 */
BasicSourceMapConsumer.prototype._findSourceIndex = function(this: BasicSourceMapConsumer, aSource: string) {
  var relativeSource = aSource;
  if (this.sourceRoot != null) {
    relativeSource = sourceMapString(runtimeMethod(util, "relative", [this.sourceRoot, relativeSource]));
  }

  if (this._sources.has(relativeSource)) {
    return this._sources.indexOf(relativeSource);
  }

  // Maybe aSource is an absolute URL as returned by |sources|.  In
  // this case we can't simply undo the transform.
  var i: number;
  for (i = 0; i < this._absoluteSources.length; ++i) {
    if (this._absoluteSources[i] == aSource) {
      return i;
    }
  }

  return -1;
};

/**
 * Create a BasicSourceMapConsumer from a SourceMapGenerator.
 *
 * @param SourceMapGenerator aSourceMap
 *        The source map that will be consumed.
 * @param String aSourceMapURL
 *        The URL at which the source map can be found (optional)
 * @returns BasicSourceMapConsumer
 */
BasicSourceMapConsumer.fromSourceMap =
  function SourceMapConsumer_fromSourceMap(aSourceMap: Generator, aSourceMapURL?: string | null) {
    var smc = allocatedBasicConsumer(Object.create(BasicSourceMapConsumer.prototype));

    var names = smc._names = ArraySet.fromArray(aSourceMap._names.toArray(), true);
    var sources = smc._sources = ArraySet.fromArray(aSourceMap._sources.toArray(), true);
    smc.sourceRoot = aSourceMap._sourceRoot;
    smc.sourcesContent = aSourceMap._generateSourcesContent(smc._sources.toArray(),
                                                            smc.sourceRoot);
    smc.file = aSourceMap._file;
    smc._sourceMapURL = aSourceMapURL;
    smc._absoluteSources = smc._sources.toArray().map(function (s) {
      return sourceMapString(runtimeMethod(util, "computeSourceURL", [smc.sourceRoot, s, aSourceMapURL]));
    });

    // Because we are modifying the entries (by converting string sources and
    // names to indices into the sources and names ArraySets), we have to make
    // a copy of the entry or else bad things happen. Shared mutable state
    // strikes again! See github issue #191.

    var generatedMappings = aSourceMap._mappings.toArray().slice();
    var destGeneratedMappings: DeflatedMapping[] = smc.__generatedMappings = [];
    var destOriginalMappings: DeflatedMapping[] = smc.__originalMappings = [];

    for (var i = 0, length = generatedMappings.length; i < length; i++) {
      var srcMapping = generatedMappings[i];
      var destMapping = new Mapping;
      destMapping.generatedLine = srcMapping.generatedLine;
      destMapping.generatedColumn = srcMapping.generatedColumn;

      if (srcMapping.source) {
        destMapping.source = sources.indexOf(srcMapping.source);
        destMapping.originalLine = srcMapping.originalLine;
        destMapping.originalColumn = srcMapping.originalColumn;

        if (srcMapping.name) {
          destMapping.name = names.indexOf(srcMapping.name);
        }

        destOriginalMappings.push(destMapping);
      }

      destGeneratedMappings.push(destMapping);
    }

    quickSort(smc.__originalMappings, util.compareByOriginalPositions);

    return smc;
  };

/**
 * The version of the source mapping spec that we are consuming.
 */
BasicSourceMapConsumer.prototype._version = 3;

/**
 * The list of original sources.
 */
Object.defineProperty(BasicSourceMapConsumer.prototype, 'sources', {
  get: function (this: BasicSourceMapConsumer) {
    return this._absoluteSources.slice();
  }
});

/**
 * Provide the JIT with a nice shape / hidden class.
 */
class Mapping {
  declare generatedLine: Coordinate;
  declare generatedColumn: Coordinate;
  declare source: number | null | undefined;
  declare originalLine: Coordinate;
  declare originalColumn: Coordinate;
  declare name: number | null | undefined;
  declare lastGeneratedColumn?: number | null;
  constructor() {
  this.generatedLine = 0;
  this.generatedColumn = 0;
  this.source = null;
  this.originalLine = null;
  this.originalColumn = null;
  this.name = null;
}
}

/**
 * Parse the mappings in a string in to a data structure which we can easily
 * query (the ordered arrays in the `this.__generatedMappings` and
 * `this.__originalMappings` properties).
 */
BasicSourceMapConsumer.prototype._parseMappings =
  function SourceMapConsumer_parseMappings(this: BasicSourceMapConsumer, aStr: unknown, aSourceRoot: unknown) {
    var generatedLine = 1;
    var previousGeneratedColumn = 0;
    var previousOriginalLine = 0;
    var previousOriginalColumn = 0;
    var previousSource = 0;
    var previousName = 0;
    var length = Number(sourceMapProperty(aStr, "length"));
    var index = 0;
    var cachedSegments: Record<string, number[] | undefined> = {};
    var temp: {value?: number; rest?: number} = {};
    var originalMappings: DeflatedMapping[] = [];
    var generatedMappings: DeflatedMapping[] = [];
    var mapping: Mapping, str: string, segment: number[] | undefined, end: number, value: number;

    while (index < length) {
      if (runtimeMethod(aStr, 'charAt', [index]) === ';') {
        generatedLine++;
        index++;
        previousGeneratedColumn = 0;
      }
      else if (runtimeMethod(aStr, 'charAt', [index]) === ',') {
        index++;
      }
      else {
        mapping = new Mapping();
        mapping.generatedLine = generatedLine;

        // Because each offset is encoded relative to the previous one,
        // many segments often have the same encoding. We can exploit this
        // fact by caching the parsed variable length fields of each segment,
        // allowing us to avoid a second parse if we encounter the same
        // segment again.
        for (end = index; end < length; end++) {
          if (this._charIsMappingSeparator(aStr, end)) {
            break;
          }
        }
        str = sourceMapString(runtimeMethod(aStr, "slice", [index, end]));

        segment = cachedSegments[str];
        if (segment) {
          index += str.length;
        } else {
          segment = [];
          while (index < end) {
            runtimeCall(base64VLQ.decode, base64VLQ, [aStr, index, temp]);
            value = temp.value!;
            index = temp.rest!;
            segment.push(value);
          }

          if (segment.length === 2) {
            throw new Error('Found a source, but no line and column');
          }

          if (segment.length === 3) {
            throw new Error('Found a source and line, but no column');
          }

          cachedSegments[str] = segment;
        }

        // Generated column.
        mapping.generatedColumn = previousGeneratedColumn + segment[0];
        previousGeneratedColumn = mapping.generatedColumn;

        if (segment.length > 1) {
          // Original source.
          mapping.source = previousSource + segment[1];
          previousSource += segment[1];

          // Original line.
          mapping.originalLine = previousOriginalLine + segment[2];
          previousOriginalLine = mapping.originalLine;
          // Lines are stored 0-based
          mapping.originalLine += 1;

          // Original column.
          mapping.originalColumn = previousOriginalColumn + segment[3];
          previousOriginalColumn = mapping.originalColumn;

          if (segment.length > 4) {
            // Original name.
            mapping.name = previousName + segment[4];
            previousName += segment[4];
          }
        }

        generatedMappings.push(mapping);
        if (typeof mapping.originalLine === 'number') {
          originalMappings.push(mapping);
        }
      }
    }

    quickSort(generatedMappings, util.compareByGeneratedPositionsDeflated);
    this.__generatedMappings = generatedMappings;

    quickSort(originalMappings, util.compareByOriginalPositions);
    this.__originalMappings = originalMappings;
  };

/**
 * Find the mapping that best matches the hypothetical "needle" mapping that
 * we are searching for in the given "haystack" of mappings.
 */
BasicSourceMapConsumer.prototype._findMapping =
  function SourceMapConsumer_findMapping(this: BasicSourceMapConsumer, aNeedle: MappingFields, aMappings: DeflatedMapping[], aLineName: "generatedLine" | "originalLine",
                                         aColumnName: "generatedColumn" | "originalColumn", aComparator: (left: MappingFields, right: MappingFields, onlyPosition?: boolean) => number, aBias?: number) {
    // To return the position we are searching for, we must first find the
    // mapping for the given position and then return the opposite position it
    // points to. Because the mappings are sorted, we can use binary search to
    // find the best mapping.

    if (Number(aNeedle[aLineName]) <= 0) {
      throw new TypeError('Line must be greater than or equal to 1, got '
                          + aNeedle[aLineName]);
    }
    if (Number(aNeedle[aColumnName]) < 0) {
      throw new TypeError('Column must be greater than or equal to 0, got '
                          + aNeedle[aColumnName]);
    }

    return binarySearch.search(aNeedle, aMappings, aComparator, aBias);
  };

/**
 * Compute the last column for each generated mapping. The last column is
 * inclusive.
 */
BasicSourceMapConsumer.prototype.computeColumnSpans =
  function SourceMapConsumer_computeColumnSpans(this: BasicSourceMapConsumer) {
    for (var index = 0; index < this._generatedMappings.length; ++index) {
      var mapping = this._generatedMappings[index];

      // Mappings do not contain a field for the last generated columnt. We
      // can come up with an optimistic estimate, however, by assuming that
      // mappings are contiguous (i.e. given two consecutive mappings, the
      // first mapping ends where the second one starts).
      if (index + 1 < this._generatedMappings.length) {
        var nextMapping = this._generatedMappings[index + 1];

        if (mapping.generatedLine === nextMapping.generatedLine) {
          mapping.lastGeneratedColumn = Number(nextMapping.generatedColumn) - 1;
          continue;
        }
      }

      // The last mapping for each line spans the entire line.
      mapping.lastGeneratedColumn = Infinity;
    }
  };

/**
 * Returns the original source, line, and column information for the generated
 * source's line and column positions provided. The only argument is an object
 * with the following properties:
 *
 *   - line: The line number in the generated source.  The line number
 *     is 1-based.
 *   - column: The column number in the generated source.  The column
 *     number is 0-based.
 *   - bias: Either 'SourceMapConsumer.GREATEST_LOWER_BOUND' or
 *     'SourceMapConsumer.LEAST_UPPER_BOUND'. Specifies whether to return the
 *     closest element that is smaller than or greater than the one we are
 *     searching for, respectively, if the exact element cannot be found.
 *     Defaults to 'SourceMapConsumer.GREATEST_LOWER_BOUND'.
 *
 * and an object is returned with the following properties:
 *
 *   - source: The original source file, or null.
 *   - line: The line number in the original source, or null.  The
 *     line number is 1-based.
 *   - column: The column number in the original source, or null.  The
 *     column number is 0-based.
 *   - name: The original identifier, or null.
 */
BasicSourceMapConsumer.prototype.originalPositionFor =
  function SourceMapConsumer_originalPositionFor(this: BasicSourceMapConsumer, aArgs: GeneratedQuery): OriginalPosition {
    var needle = {
      generatedLine: util.getArg(aArgs, 'line'),
      generatedColumn: util.getArg(aArgs, 'column')
    };

    var index = this._findMapping!(
      needle,
      this._generatedMappings,
      "generatedLine",
      "generatedColumn",
      util.compareByGeneratedPositionsDeflated,
      util.getArg(aArgs, 'bias', SourceMapConsumer.GREATEST_LOWER_BOUND)
    );

    if (index >= 0) {
      var mapping = this._generatedMappings[index];

      if (mapping.generatedLine === needle.generatedLine) {
        var source: number | string | null | undefined = util.getArg(mapping, 'source', null);
        if (source !== null) {
          source = this._sources.at(source!);
          source = sourceMapString(runtimeMethod(util, "computeSourceURL", [this.sourceRoot, source, this._sourceMapURL]));
        }
        var name: number | string | null | undefined = util.getArg(mapping, 'name', null);
        if (name !== null) {
          name = this._names.at(name!);
        }
        return {
          source: source,
          line: util.getArg(mapping, 'originalLine', null),
          column: util.getArg(mapping, 'originalColumn', null),
          name: name
        };
      }
    }

    return {
      source: null,
      line: null,
      column: null,
      name: null
    };
  };

/**
 * Return true if we have the source content for every source in the source
 * map, false otherwise.
 */
BasicSourceMapConsumer.prototype.hasContentsOfAllSources =
  function BasicSourceMapConsumer_hasContentsOfAllSources(this: BasicSourceMapConsumer) {
    if (!this.sourcesContent) {
      return false;
    }
    return Number(sourceMapProperty(this.sourcesContent, "length")) >= this._sources.size() &&
      !sourceMapMethod(this.sourcesContent, "some", [function (sc: unknown) { return sc == null; }], "this.sourcesContent.some");
  };

/**
 * Returns the original source content. The only argument is the url of the
 * original source file. Returns null if no original source content is
 * available.
 */
BasicSourceMapConsumer.prototype.sourceContentFor =
  function SourceMapConsumer_sourceContentFor(this: BasicSourceMapConsumer, aSource: string, nullOnMissing?: boolean) {
    if (!this.sourcesContent) {
      return null;
    }

    var index = this._findSourceIndex!(aSource);
    if (index >= 0) {
      return sourceMapProperty(this.sourcesContent, index);
    }

    var relativeSource = aSource;
    if (this.sourceRoot != null) {
      relativeSource = sourceMapString(runtimeMethod(util, "relative", [this.sourceRoot, relativeSource]));
    }

    var url: unknown;
    if (this.sourceRoot != null
        && (url = runtimeCall(util.urlParse, util, [this.sourceRoot]))) {
      // XXX: file:// URIs and absolute paths lead to unexpected behavior for
      // many users. We can help them out when they expect file:// URIs to
      // behave like it would if they were running a local HTTP server. See
      // https://bugzilla.mozilla.org/show_bug.cgi?id=885597.
      var fileUriAbsPath = relativeSource.replace(/^file:\/\//, "");
      if (sourceMapProperty(url, "scheme") == "file"
          && this._sources.has(fileUriAbsPath)) {
        return sourceMapProperty(this.sourcesContent, this._sources.indexOf(fileUriAbsPath))
      }

      if ((!sourceMapProperty(url, "path") || sourceMapProperty(url, "path") == "/")
          && this._sources.has("/" + relativeSource)) {
        return sourceMapProperty(this.sourcesContent, this._sources.indexOf("/" + relativeSource));
      }
    }

    // This function is used recursively from
    // IndexedSourceMapConsumer.prototype.sourceContentFor. In that case, we
    // don't want to throw if we can't find the source - we just want to
    // return null, so we provide a flag to exit gracefully.
    if (nullOnMissing) {
      return null;
    }
    else {
      throw new Error('"' + relativeSource + '" is not in the SourceMap.');
    }
  };

/**
 * Returns the generated line and column information for the original source,
 * line, and column positions provided. The only argument is an object with
 * the following properties:
 *
 *   - source: The filename of the original source.
 *   - line: The line number in the original source.  The line number
 *     is 1-based.
 *   - column: The column number in the original source.  The column
 *     number is 0-based.
 *   - bias: Either 'SourceMapConsumer.GREATEST_LOWER_BOUND' or
 *     'SourceMapConsumer.LEAST_UPPER_BOUND'. Specifies whether to return the
 *     closest element that is smaller than or greater than the one we are
 *     searching for, respectively, if the exact element cannot be found.
 *     Defaults to 'SourceMapConsumer.GREATEST_LOWER_BOUND'.
 *
 * and an object is returned with the following properties:
 *
 *   - line: The line number in the generated source, or null.  The
 *     line number is 1-based.
 *   - column: The column number in the generated source, or null.
 *     The column number is 0-based.
 */
BasicSourceMapConsumer.prototype.generatedPositionFor =
  function SourceMapConsumer_generatedPositionFor(this: BasicSourceMapConsumer, aArgs: OriginalQuery): GeneratedPosition {
    var source: string | number = util.getArg(aArgs, 'source');
    source = this._findSourceIndex!(source);
    if (source < 0) {
      return {
        line: null,
        column: null,
        lastColumn: null
      };
    }

    var needle: MappingFields = {
      source: source,
      originalLine: util.getArg(aArgs, 'line'),
      originalColumn: util.getArg(aArgs, 'column')
    };

    var index = this._findMapping!(
      needle,
      this._originalMappings,
      "originalLine",
      "originalColumn",
      util.compareByOriginalPositions,
      util.getArg(aArgs, 'bias', SourceMapConsumer.GREATEST_LOWER_BOUND)
    );

    if (index >= 0) {
      var mapping = this._originalMappings[index];

      if (mapping.source === needle.source) {
        return {
          line: util.getArg(mapping, 'generatedLine', null),
          column: util.getArg(mapping, 'generatedColumn', null),
          lastColumn: util.getArg(mapping, 'lastGeneratedColumn', null)
        };
      }
    }

    return {
      line: null,
      column: null,
      lastColumn: null
    };
  };

exports.BasicSourceMapConsumer = BasicSourceMapConsumer;

/**
 * An IndexedSourceMapConsumer instance represents a parsed source map which
 * we can query for information. It differs from BasicSourceMapConsumer in
 * that it takes "indexed" source maps (i.e. ones with a "sections" field) as
 * input.
 *
 * The first parameter is a raw source map (either as a JSON string, or already
 * parsed to an object). According to the spec for indexed source maps, they
 * have the following attributes:
 *
 *   - version: Which version of the source map spec this map is following.
 *   - file: Optional. The generated file this source map is associated with.
 *   - sections: A list of section definitions.
 *
 * Each value under the "sections" field has two fields:
 *   - offset: The offset into the original specified at which this section
 *       begins to apply, defined as an object with a "line" and "column"
 *       field.
 *   - map: A source map definition. This source map could also be indexed,
 *       but doesn't have to be.
 *
 * Instead of the "map" field, it's also possible to have a "url" field
 * specifying a URL to retrieve a source map from, but that's currently
 * unsupported.
 *
 * Here's an example source map, taken from the source map spec[0], but
 * modified to omit a section which uses the "url" field.
 *
 *  {
 *    version : 3,
 *    file: "app.js",
 *    sections: [{
 *      offset: {line:100, column:10},
 *      map: {
 *        version : 3,
 *        file: "section.js",
 *        sources: ["foo.js", "bar.js"],
 *        names: ["src", "maps", "are", "fun"],
 *        mappings: "AAAA,E;;ABCDE;"
 *      }
 *    }],
 *  }
 *
 * The second parameter, if given, is a string whose value is the URL
 * at which the source map was found.  This URL is used to compute the
 * sources array.
 *
 * [0]: https://docs.google.com/document/d/1U1RGAehQwRypUTovF1KRlpiOFze0b-_2gc6fAH0KY0k/edit#heading=h.535es3xeprgt
 */
class IndexedSourceMapConsumer {
  declare _version: number;
  declare _sources: ArraySetLayout;
  declare _names: ArraySetLayout;
  declare _mappings: unknown;
  declare _sourceMapURL: string | null | undefined;
  declare sourceRoot: unknown;
  declare file: unknown;
  declare sourcesContent: unknown;
  declare sources: string[];
  declare __generatedMappings: DeflatedMapping[] | null;
  declare __originalMappings: DeflatedMapping[] | null;
  declare _generatedMappings: DeflatedMapping[];
  declare _originalMappings: DeflatedMapping[];
  declare _charIsMappingSeparator: (text: unknown, index: number) => boolean;
  declare _parseMappings: (text: unknown, sourceRoot: unknown) => void;
  declare eachMapping: Consumer["eachMapping"];
  declare allGeneratedPositionsFor: Consumer["allGeneratedPositionsFor"];
  declare originalPositionFor: Consumer["originalPositionFor"];
  declare generatedPositionFor: Consumer["generatedPositionFor"];
  declare sourceContentFor: Consumer["sourceContentFor"];
  declare hasContentsOfAllSources: Consumer["hasContentsOfAllSources"];
  declare _findSourceIndex: ((source: string) => number) | undefined;
  declare _findMapping: ((needle: MappingFields, mappings: DeflatedMapping[], lineName: "generatedLine" | "originalLine", columnName: "generatedColumn" | "originalColumn", comparator: (left: MappingFields, right: MappingFields, onlyPosition?: boolean) => number, bias?: number) => number) | undefined;

  declare _sections: Section[];
  constructor(aSourceMap: unknown, aSourceMapURL?: string | null) {
  var sourceMap = aSourceMap;
  if (typeof aSourceMap === 'string') {
    sourceMap = util.parseSourceMapInput(aSourceMap);
  }

  var version = util.getArg(sourceMap, 'version');
  var sections = util.getArg(sourceMap, 'sections');

  if (version != this._version) {
    throw new Error('Unsupported version: ' + version);
  }

  this._sources = new ArraySet();
  this._names = new ArraySet();

  var lastOffset: unknown = {
    line: -1,
    column: 0
  };
  this._sections = sourceMapArray(sections).map(function (s) {
    if (sourceMapProperty(s, "url")) {
      // The url field will require support for asynchronicity.
      // See https://github.com/mozilla/source-map/issues/16
      throw new Error('Support for url field in sections not implemented.');
    }
    var offset = util.getArg(s, 'offset');
    var offsetLine = util.getArg(offset, 'line');
    var offsetColumn = util.getArg(offset, 'column');

    if (sourceMapLess(offsetLine, sourceMapProperty(lastOffset, "line")) ||
        (offsetLine === sourceMapProperty(lastOffset, "line") && sourceMapLess(offsetColumn, sourceMapProperty(lastOffset, "column")))) {
      throw new Error('Section offsets must be ordered and non-overlapping.');
    }
    lastOffset = offset;

    return {
      generatedOffset: {
        // The offset fields are 0-based, but we use 1-based indices when
        // encoding/decoding from VLQ.
        generatedLine: sourceMapAddNumber(offsetLine, 1),
        generatedColumn: sourceMapAddNumber(offsetColumn, 1)
      },
      consumer: new SourceMapConsumer(util.getArg(s, 'map'), aSourceMapURL)
    }
  });
}
}

Object.setPrototypeOf(IndexedSourceMapConsumer.prototype, SourceMapConsumer.prototype);
delete record(IndexedSourceMapConsumer.prototype)[constructorKey];
IndexedSourceMapConsumer.prototype.constructor = SourceMapConsumer;

/**
 * The version of the source mapping spec that we are consuming.
 */
IndexedSourceMapConsumer.prototype._version = 3;

/**
 * The list of original sources.
 */
Object.defineProperty(IndexedSourceMapConsumer.prototype, 'sources', {
  get: function (this: IndexedSourceMapConsumer) {
    var sources: string[] = [];
    for (var i = 0; i < this._sections.length; i++) {
      for (var j = 0; j < this._sections[i].consumer.sources.length; j++) {
        sources.push(this._sections[i].consumer.sources[j]);
      }
    }
    return sources;
  }
});

/**
 * Returns the original source, line, and column information for the generated
 * source's line and column positions provided. The only argument is an object
 * with the following properties:
 *
 *   - line: The line number in the generated source.  The line number
 *     is 1-based.
 *   - column: The column number in the generated source.  The column
 *     number is 0-based.
 *
 * and an object is returned with the following properties:
 *
 *   - source: The original source file, or null.
 *   - line: The line number in the original source, or null.  The
 *     line number is 1-based.
 *   - column: The column number in the original source, or null.  The
 *     column number is 0-based.
 *   - name: The original identifier, or null.
 */
IndexedSourceMapConsumer.prototype.originalPositionFor =
  function IndexedSourceMapConsumer_originalPositionFor(this: IndexedSourceMapConsumer, aArgs: GeneratedQuery): OriginalPosition {
    var needle = {
      generatedLine: util.getArg(aArgs, 'line'),
      generatedColumn: util.getArg(aArgs, 'column')
    };

    // Find the section containing the generated position we're trying to map
    // to an original position.
    var sectionIndex = binarySearch.search(needle, this._sections,
      function(needle: { generatedLine?: Coordinate; generatedColumn?: Coordinate; }, section: Section) {
        var cmp = Number(needle.generatedLine) - Number(section.generatedOffset.generatedLine);
        if (cmp) {
          return cmp;
        }

        return (Number(needle.generatedColumn) -
                Number(section.generatedOffset.generatedColumn));
      });
    var section = this._sections[sectionIndex];

    if (!section) {
      return {
        source: null,
        line: null,
        column: null,
        name: null
      };
    }

    return section.consumer.originalPositionFor({
      line: Number(needle.generatedLine) -
        (Number(section.generatedOffset.generatedLine) - 1),
      column: Number(needle.generatedColumn) -
        (section.generatedOffset.generatedLine === needle.generatedLine
         ? Number(section.generatedOffset.generatedColumn) - 1
         : 0),
      bias: aArgs.bias
    });
  };

/**
 * Return true if we have the source content for every source in the source
 * map, false otherwise.
 */
IndexedSourceMapConsumer.prototype.hasContentsOfAllSources =
  function IndexedSourceMapConsumer_hasContentsOfAllSources(this: IndexedSourceMapConsumer) {
    return this._sections.every(function (s) {
      return s.consumer.hasContentsOfAllSources();
    });
  };

/**
 * Returns the original source content. The only argument is the url of the
 * original source file. Returns null if no original source content is
 * available.
 */
IndexedSourceMapConsumer.prototype.sourceContentFor =
  function IndexedSourceMapConsumer_sourceContentFor(this: IndexedSourceMapConsumer, aSource: string, nullOnMissing?: boolean) {
    for (var i = 0; i < this._sections.length; i++) {
      var section = this._sections[i];

      var content = section.consumer.sourceContentFor(aSource, true);
      if (content) {
        return content;
      }
    }
    if (nullOnMissing) {
      return null;
    }
    else {
      throw new Error('"' + aSource + '" is not in the SourceMap.');
    }
  };

/**
 * Returns the generated line and column information for the original source,
 * line, and column positions provided. The only argument is an object with
 * the following properties:
 *
 *   - source: The filename of the original source.
 *   - line: The line number in the original source.  The line number
 *     is 1-based.
 *   - column: The column number in the original source.  The column
 *     number is 0-based.
 *
 * and an object is returned with the following properties:
 *
 *   - line: The line number in the generated source, or null.  The
 *     line number is 1-based. 
 *   - column: The column number in the generated source, or null.
 *     The column number is 0-based.
 */
IndexedSourceMapConsumer.prototype.generatedPositionFor =
  function IndexedSourceMapConsumer_generatedPositionFor(this: IndexedSourceMapConsumer, aArgs: OriginalQuery): GeneratedPosition {
    for (var i = 0; i < this._sections.length; i++) {
      var section = this._sections[i];

      // Only consider this section if the requested source is in the list of
      // sources of the consumer.
      if (section.consumer._findSourceIndex!(util.getArg(aArgs, 'source')) === -1) {
        continue;
      }
      var generatedPosition = section.consumer.generatedPositionFor(aArgs);
      if (generatedPosition) {
        var ret = {
          line: Number(generatedPosition.line) +
            (Number(section.generatedOffset.generatedLine) - 1),
          column: Number(generatedPosition.column) +
            (section.generatedOffset.generatedLine === generatedPosition.line
             ? Number(section.generatedOffset.generatedColumn) - 1
             : 0)
        };
        return ret;
      }
    }

    return {
      line: null,
      column: null
    };
  };

/**
 * Parse the mappings in a string in to a data structure which we can easily
 * query (the ordered arrays in the `this.__generatedMappings` and
 * `this.__originalMappings` properties).
 */
IndexedSourceMapConsumer.prototype._parseMappings =
  function IndexedSourceMapConsumer_parseMappings(this: IndexedSourceMapConsumer, aStr: unknown, aSourceRoot: unknown) {
    this.__generatedMappings = [];
    this.__originalMappings = [];
    for (var i = 0; i < this._sections.length; i++) {
      var section = this._sections[i];
      var sectionMappings = section.consumer._generatedMappings;
      for (var j = 0; j < sectionMappings.length; j++) {
        var mapping = sectionMappings[j];

        var source: string | number | undefined = section.consumer._sources.at(mapping.source!);
        source = sourceMapString(runtimeMethod(util, "computeSourceURL", [section.consumer.sourceRoot, source, this._sourceMapURL]));
        this._sources.add(source);
        source = this._sources.indexOf(source);

        var name: string | number | null | undefined = null;
        if (mapping.name) {
          name = section.consumer._names.at(mapping.name);
          this._names.add(name!);
          name = this._names.indexOf(name!);
        }

        // The mappings coming from the consumer for the section have
        // generated positions relative to the start of the section, so we
        // need to offset them to be relative to the start of the concatenated
        // generated file.
        var adjustedMapping = {
          source: source,
          generatedLine: Number(mapping.generatedLine) +
            (Number(section.generatedOffset.generatedLine) - 1),
          generatedColumn: Number(mapping.generatedColumn) +
            (section.generatedOffset.generatedLine === mapping.generatedLine
            ? Number(section.generatedOffset.generatedColumn) - 1
            : 0),
          originalLine: mapping.originalLine,
          originalColumn: mapping.originalColumn,
          name: name
        };

        this.__generatedMappings.push(adjustedMapping);
        if (typeof adjustedMapping.originalLine === 'number') {
          this.__originalMappings.push(adjustedMapping);
        }
      }
    }

    quickSort(this.__generatedMappings, util.compareByGeneratedPositionsDeflated);
    quickSort(this.__originalMappings, util.compareByOriginalPositions);
  };

exports.IndexedSourceMapConsumer = IndexedSourceMapConsumer;


/***/ 
if (!exportsReady(exports, ["SourceMapConsumer", "BasicSourceMapConsumer", "IndexedSourceMapConsumer"])) throw new TypeError("Incomplete original source-map exports");
return exports;
}
