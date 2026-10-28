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
// Original module: https://github.com/validatorjs/validator.js/blob/3847c6f90192bf9eec1aabc1bcb33e33d5810881/src/lib/isMailtoURI.js
// Original ES-module syntax replaces the bundle's Babel/CommonJS export helpers.

import trim from './trim.ts';
import isEmail from './isEmail.ts';
import assertString from './util/assertString.ts';

function parseMailtoQueryString(queryString: string) {
  const allowedParams = new Set(['subject', 'body', 'cc', 'bcc']),
    query = { cc: '', bcc: '' };
  let isParseFailed = false;

  const queryParams = queryString.split('&');

  if (queryParams.length > 4) {
    return false;
  }

  for (const q of queryParams) {
    const [key, value] = q.split('=');

    // checked for invalid and duplicated query params
    if (key && !allowedParams.has(key)) {
      isParseFailed = true;
      break;
    }

    if (value && (key === 'cc' || key === 'bcc')) {
      query[key] = value;
    }

    if (key) {
      allowedParams.delete(key);
    }
  }

  return isParseFailed ? false : query;
}

export default function isMailtoURI(url: string, options?: Parameters<typeof isEmail>[1]) {
  assertString(url);

  if (url.indexOf('mailto:') !== 0) {
    return false;
  }

  const [to, queryString = ''] = url.replace('mailto:', '').split('?');

  if (!to && !queryString) {
    return true;
  }

  const query = parseMailtoQueryString(queryString);

  if (!query) {
    return false;
  }

  return `${to},${query.cc},${query.bcc}`
    .split(',')
    .every((email) => {
      email = trim(email, ' ');

      if (email) {
        return isEmail(email, options);
      }

      return true;
    });
}
