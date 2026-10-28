/*
Copyright (c) 2018 Chris O'Hara <cohara87@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

// JetStream source: https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/validatorjs/dist/bundle.es6.js.map
// Original module: https://github.com/validatorjs/validator.js/blob/3847c6f90192bf9eec1aabc1bcb33e33d5810881/src/lib/isLength.js
// Original ES-module syntax replaces the bundle's Babel/CommonJS export helpers.

import assertString from './util/assertString.ts';

/* eslint-disable prefer-rest-params */
export default function isLength(str: string, options?: { min?: number; max?: number; discreteLengths?: unknown } | number, ...legacy: [max?: number]) {
  assertString(str);
  let min;
  let max;

  if (typeof (options) === 'object') {
    min = options.min || 0;
    max = options.max;
  } else { // backwards compatibility: isLength(str, min [, max])
    min = options || 0;
    max = legacy[0];
  }

  const presentationSequences = str.match(/(\uFE0F|\uFE0E)/g) || [];
  const surrogatePairs = str.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g) || [];
  const len = str.length - presentationSequences.length - surrogatePairs.length;
  const isInsideRange = len >= min && (typeof max === 'undefined' || len <= max);

  if (isInsideRange && typeof options === 'object' && Array.isArray(options.discreteLengths)) {
    return options.discreteLengths.some((discreteLen: unknown) => discreteLen === len);
  }

  return isInsideRange;
}
