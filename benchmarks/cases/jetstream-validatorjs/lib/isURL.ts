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
// Original module: https://github.com/validatorjs/validator.js/blob/3847c6f90192bf9eec1aabc1bcb33e33d5810881/src/lib/isURL.js
// Original ES-module syntax replaces the bundle's Babel/CommonJS export helpers.

import assertString from './util/assertString.ts';
import required from './util/required.ts';
import checkHost from './util/checkHost.ts';
import includes from './util/includesString.ts';

import isFQDN from './isFQDN.ts';
import isIP from './isIP.ts';
import merge from './util/merge.ts';

/*
options for isURL method

protocols - valid protocols can be modified with this option.
require_tld - If set to false isURL will not check if the URL's host includes a top-level domain.
require_protocol - if set to true isURL will return false if protocol is not present in the URL.
require_host - if set to false isURL will not check if host is present in the URL.
require_port - if set to true isURL will check if port is present in the URL.
require_valid_protocol - isURL will check if the URL's protocol is present in the protocols option.
allow_underscores - if set to true, the validator will allow underscores in the URL.
host_whitelist - if set to an array of strings or regexp, and the domain matches none of the strings
                 defined in it, the validation fails.
host_blacklist - if set to an array of strings or regexp, and the domain matches any of the strings
                 defined in it, the validation fails.
allow_trailing_dot - if set to true, the validator will allow the domain to end with
                     a `.` character.
allow_protocol_relative_urls - if set to true protocol relative URLs will be allowed.
allow_fragments - if set to false isURL will return false if fragments are present.
allow_query_components - if set to false isURL will return false if query components are present.
disallow_auth - if set to true, the validator will fail if the URL contains an authentication
                component, e.g. `http://username:password@example.com`
validate_length - if set to false isURL will skip string length validation. `max_allowed_length`
                  will be ignored if this is set as `false`.
max_allowed_length - if set, isURL will not allow URLs longer than the specified value (default is
                     2084 that IE maximum URL length).

*/


const default_url_options = {
  protocols: ['http', 'https', 'ftp'],
  require_tld: true,
  require_protocol: false,
  require_host: true,
  require_port: false,
  require_valid_protocol: true,
  allow_underscores: false,
  allow_trailing_dot: false,
  allow_protocol_relative_urls: false,
  allow_fragments: true,
  allow_query_components: true,
  validate_length: true,
  max_allowed_length: 2084,
};

const wrapped_ipv6 = /^\[([^\]]+)\](?::([0-9]+))?$/;

export default function isURL(url: string, inputOptions?: Partial<typeof default_url_options> & { host_whitelist?: (string | RegExp)[]; host_blacklist?: (string | RegExp)[]; disallow_auth?: boolean }) {
  assertString(url);
  if (!url || /[\s<>]/.test(url)) {
    return false;
  }
  if (url.indexOf('mailto:') === 0) {
    return false;
  }
  const options = merge(inputOptions, default_url_options);

  if (options.validate_length && url.length > options.max_allowed_length) {
    return false;
  }

  if (!options.allow_fragments && includes(url, '#')) {
    return false;
  }

  if (!options.allow_query_components && (includes(url, '?') || includes(url, '&'))) {
    return false;
  }

  let protocol, auth, host, hostname, port, port_str, split, ipv6;

  split = url.split('#');
  url = required(split.shift());

  split = url.split('?');
  url = required(split.shift());

  split = url.split('://');
  if (split.length > 1) {
    protocol = required(split.shift()).toLowerCase();
    if (options.require_valid_protocol && options.protocols.indexOf(protocol) === -1) {
      return false;
    }
  } else if (options.require_protocol) {
    return false;
  } else if (url.slice(0, 2) === '//') {
    if (!options.allow_protocol_relative_urls) {
      return false;
    }
    split[0] = url.slice(2);
  }
  url = split.join('://');

  if (url === '') {
    return false;
  }

  split = url.split('/');
  url = required(split.shift());

  if (url === '' && !options.require_host) {
    return true;
  }

  split = url.split('@');
  if (split.length > 1) {
    if (options.disallow_auth) {
      return false;
    }
    if (split[0] === '') {
      return false;
    }
    auth = required(split.shift());
    if (auth.indexOf(':') >= 0 && auth.split(':').length > 2) {
      return false;
    }
    const [user, password] = auth.split(':');
    if (user === '' && password === '') {
      return false;
    }
  }
  hostname = split.join('@');

  port_str = null;
  ipv6 = null;
  const ipv6_match = hostname.match(wrapped_ipv6);
  if (ipv6_match) {
    host = '';
    ipv6 = ipv6_match[1];
    port_str = ipv6_match[2] || null;
  } else {
    split = hostname.split(':');
    host = required(split.shift());
    if (split.length) {
      port_str = split.join(':');
    }
  }

  if (port_str !== null && port_str.length > 0) {
    port = parseInt(port_str, 10);
    if (!/^[0-9]+$/.test(port_str) || port <= 0 || port > 65535) {
      return false;
    }
  } else if (options.require_port) {
    return false;
  }

  if (options.host_whitelist) {
    return checkHost(host, options.host_whitelist);
  }

  if (host === '' && !options.require_host) {
    return true;
  }

  if (!isIP(host) && !isFQDN(host, options) && (!ipv6 || !isIP(ipv6, 6))) {
    return false;
  }

  host = host || ipv6;

  if (options.host_blacklist && checkHost(host, options.host_blacklist)) {
    return false;
  }

  return true;
}
