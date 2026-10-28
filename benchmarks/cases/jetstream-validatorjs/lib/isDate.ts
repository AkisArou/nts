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
// Original module: https://github.com/validatorjs/validator.js/blob/3847c6f90192bf9eec1aabc1bcb33e33d5810881/src/lib/isDate.js
// Original ES-module syntax replaces the bundle's Babel/CommonJS export helpers.

import merge from './util/merge.ts';

const default_date_options = {
  format: 'YYYY/MM/DD',
  delimiters: ['/', '-'],
  strictMode: false,
};

function isValidFormat(format: string) {
  return /(^(y{4}|y{2})[.\/-](m{1,2})[.\/-](d{1,2})$)|(^(m{1,2})[.\/-](d{1,2})[.\/-]((y{4}|y{2})$))|(^(d{1,2})[.\/-](m{1,2})[.\/-]((y{4}|y{2})$))/gi.test(format);
}

function zip(date: string[], format: string[]) {
  const zippedArr = [],
    len = Math.max(date.length, format.length);

  for (let i = 0; i < len; i++) {
    zippedArr.push([date[i], format[i]]);
  }

  return zippedArr;
}

export default function isDate(input: unknown, inputOptions?: Partial<typeof default_date_options> | string) {
  let options;
  if (typeof inputOptions === 'string') { // Allow backward compatibility for old format isDate(input [, format])
    options = merge({ format: inputOptions }, default_date_options);
  } else {
    options = merge(inputOptions, default_date_options);
  }
  if (typeof input === 'string' && isValidFormat(options.format)) {
    if (options.strictMode && input.length !== options.format.length) return false;
    const formatDelimiter = options.delimiters
      .find(delimiter => options.format.indexOf(delimiter) !== -1);
    const dateDelimiter = options.strictMode
      ? formatDelimiter
      : options.delimiters.find(delimiter => input.indexOf(delimiter) !== -1);
    const dateAndFormat = zip(
      dateDelimiter === undefined ? [input] : input.split(dateDelimiter),
      formatDelimiter === undefined ? [options.format.toLowerCase()] : options.format.toLowerCase().split(formatDelimiter)
    );
    const dateObj: Record<string, string> = {};

    for (const [dateWord, formatWord] of dateAndFormat) {
      if (!dateWord || !formatWord || dateWord.length !== formatWord.length) {
        return false;
      }

      dateObj[formatWord.charAt(0)] = dateWord;
    }

    let fullYear = dateObj.y;

    // Check if the year starts with a hyphen
    if (fullYear.startsWith('-')) {
      return false; // Hyphen before year is not allowed
    }

    if (dateObj.y.length === 2) {
      const parsedYear = parseInt(dateObj.y, 10);

      if (isNaN(parsedYear)) {
        return false;
      }

      const currentYearLastTwoDigits = new Date().getFullYear() % 100;

      if (parsedYear < currentYearLastTwoDigits) {
        fullYear = `20${dateObj.y}`;
      } else {
        fullYear = `19${dateObj.y}`;
      }
    }

    let month = dateObj.m;

    if (dateObj.m.length === 1) {
      month = `0${dateObj.m}`;
    }

    let day = dateObj.d;

    if (dateObj.d.length === 1) {
      day = `0${dateObj.d}`;
    }

    return new Date(`${fullYear}-${month}-${day}T00:00:00.000Z`).getUTCDate() === +dateObj.d;
  }

  if (!options.strictMode) {
    return Object.prototype.toString.call(input) === '[object Date]' && isFinite(Number(input));
  }

  return false;
}
