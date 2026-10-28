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
// Original module: https://github.com/validatorjs/validator.js/blob/3847c6f90192bf9eec1aabc1bcb33e33d5810881/src/index.js
// Original ES-module syntax replaces the bundle's Babel/CommonJS export helpers.

import toDate from './lib/toDate.ts';
import toFloat from './lib/toFloat.ts';
import toInt from './lib/toInt.ts';
import toBoolean from './lib/toBoolean.ts';
import equals from './lib/equals.ts';
import contains from './lib/contains.ts';
import matches from './lib/matches.ts';

import isEmail from './lib/isEmail.ts';
import isURL from './lib/isURL.ts';
import isMACAddress from './lib/isMACAddress.ts';
import isIP from './lib/isIP.ts';
import isIPRange from './lib/isIPRange.ts';
import isFQDN from './lib/isFQDN.ts';
import isDate from './lib/isDate.ts';
import isTime from './lib/isTime.ts';

import isBoolean from './lib/isBoolean.ts';
import isLocale from './lib/isLocale.ts';

import isAbaRouting from './lib/isAbaRouting.ts';
import isAlpha, { locales as isAlphaLocales } from './lib/isAlpha.ts';
import isAlphanumeric, { locales as isAlphanumericLocales } from './lib/isAlphanumeric.ts';
import isNumeric from './lib/isNumeric.ts';
import isPassportNumber, { locales as passportNumberLocales } from './lib/isPassportNumber.ts';
import isPort from './lib/isPort.ts';
import isLowercase from './lib/isLowercase.ts';
import isUppercase from './lib/isUppercase.ts';

import isIMEI from './lib/isIMEI.ts';

import isAscii from './lib/isAscii.ts';
import isFullWidth from './lib/isFullWidth.ts';
import isHalfWidth from './lib/isHalfWidth.ts';
import isVariableWidth from './lib/isVariableWidth.ts';
import isMultibyte from './lib/isMultibyte.ts';
import isSemVer from './lib/isSemVer.ts';
import isSurrogatePair from './lib/isSurrogatePair.ts';

import isInt from './lib/isInt.ts';
import isFloat, { locales as isFloatLocales } from './lib/isFloat.ts';
import isDecimal from './lib/isDecimal.ts';
import isHexadecimal from './lib/isHexadecimal.ts';
import isOctal from './lib/isOctal.ts';
import isDivisibleBy from './lib/isDivisibleBy.ts';

import isHexColor from './lib/isHexColor.ts';
import isRgbColor from './lib/isRgbColor.ts';
import isHSL from './lib/isHSL.ts';

import isISRC from './lib/isISRC.ts';

import isIBAN, { locales as ibanLocales } from './lib/isIBAN.ts';
import isBIC from './lib/isBIC.ts';

import isMD5 from './lib/isMD5.ts';
import isHash from './lib/isHash.ts';
import isJWT from './lib/isJWT.ts';

import isJSON from './lib/isJSON.ts';
import isEmpty from './lib/isEmpty.ts';

import isLength from './lib/isLength.ts';
import isByteLength from './lib/isByteLength.ts';

import isULID from './lib/isULID.ts';
import isUUID from './lib/isUUID.ts';
import isMongoId from './lib/isMongoId.ts';

import isAfter from './lib/isAfter.ts';
import isBefore from './lib/isBefore.ts';

import isIn from './lib/isIn.ts';

import isLuhnNumber from './lib/isLuhnNumber.ts';
import isCreditCard from './lib/isCreditCard.ts';
import isIdentityCard from './lib/isIdentityCard.ts';

import isEAN from './lib/isEAN.ts';
import isISIN from './lib/isISIN.ts';
import isISBN from './lib/isISBN.ts';
import isISSN from './lib/isISSN.ts';
import isTaxID from './lib/isTaxID.ts';

import isMobilePhone, { locales as isMobilePhoneLocales } from './lib/isMobilePhone.ts';

import isEthereumAddress from './lib/isEthereumAddress.ts';

import isCurrency from './lib/isCurrency.ts';

import isBtcAddress from './lib/isBtcAddress.ts';

import { isISO6346, isFreightContainerID } from './lib/isISO6346.ts';
import isISO6391 from './lib/isISO6391.ts';
import isISO8601 from './lib/isISO8601.ts';
import isRFC3339 from './lib/isRFC3339.ts';
import isISO15924 from './lib/isISO15924.ts';
import isISO31661Alpha2 from './lib/isISO31661Alpha2.ts';
import isISO31661Alpha3 from './lib/isISO31661Alpha3.ts';
import isISO31661Numeric from './lib/isISO31661Numeric.ts';
import isISO4217 from './lib/isISO4217.ts';

import isBase32 from './lib/isBase32.ts';
import isBase58 from './lib/isBase58.ts';
import isBase64 from './lib/isBase64.ts';
import isDataURI from './lib/isDataURI.ts';
import isMagnetURI from './lib/isMagnetURI.ts';
import isMailtoURI from './lib/isMailtoURI.ts';

import isMimeType from './lib/isMimeType.ts';

import isLatLong from './lib/isLatLong.ts';
import isPostalCode, { locales as isPostalCodeLocales } from './lib/isPostalCode.ts';

import ltrim from './lib/ltrim.ts';
import rtrim from './lib/rtrim.ts';
import trim from './lib/trim.ts';
import escape from './lib/escape.ts';
import unescape from './lib/unescape.ts';
import stripLow from './lib/stripLow.ts';
import whitelist from './lib/whitelist.ts';
import blacklist from './lib/blacklist.ts';
import isWhitelisted from './lib/isWhitelisted.ts';

import normalizeEmail from './lib/normalizeEmail.ts';

import isSlug from './lib/isSlug.ts';
import isLicensePlate from './lib/isLicensePlate.ts';
import isStrongPassword from './lib/isStrongPassword.ts';

import isVAT from './lib/isVAT.ts';

const version = '13.15.15';

const validator = {
  version,
  toDate,
  toFloat,
  toInt,
  toBoolean,
  equals,
  contains,
  matches,
  isEmail,
  isURL,
  isMACAddress,
  isIP,
  isIPRange,
  isFQDN,
  isBoolean,
  isIBAN,
  isBIC,
  isAbaRouting,
  isAlpha,
  isAlphaLocales,
  isAlphanumeric,
  isAlphanumericLocales,
  isNumeric,
  isPassportNumber,
  passportNumberLocales,
  isPort,
  isLowercase,
  isUppercase,
  isAscii,
  isFullWidth,
  isHalfWidth,
  isVariableWidth,
  isMultibyte,
  isSemVer,
  isSurrogatePair,
  isInt,
  isIMEI,
  isFloat,
  isFloatLocales,
  isDecimal,
  isHexadecimal,
  isOctal,
  isDivisibleBy,
  isHexColor,
  isRgbColor,
  isHSL,
  isISRC,
  isMD5,
  isHash,
  isJWT,
  isJSON,
  isEmpty,
  isLength,
  isLocale,
  isByteLength,
  isULID,
  isUUID,
  isMongoId,
  isAfter,
  isBefore,
  isIn,
  isLuhnNumber,
  isCreditCard,
  isIdentityCard,
  isEAN,
  isISIN,
  isISBN,
  isISSN,
  isMobilePhone,
  isMobilePhoneLocales,
  isPostalCode,
  isPostalCodeLocales,
  isEthereumAddress,
  isCurrency,
  isBtcAddress,
  isISO6346,
  isFreightContainerID,
  isISO6391,
  isISO8601,
  isISO15924,
  isRFC3339,
  isISO31661Alpha2,
  isISO31661Alpha3,
  isISO31661Numeric,
  isISO4217,
  isBase32,
  isBase58,
  isBase64,
  isDataURI,
  isMagnetURI,
  isMailtoURI,
  isMimeType,
  isLatLong,
  ltrim,
  rtrim,
  trim,
  escape,
  unescape,
  stripLow,
  whitelist,
  blacklist,
  isWhitelisted,
  normalizeEmail,
  toString,
  isSlug,
  isStrongPassword,
  isTaxID,
  isDate,
  isTime,
  isLicensePlate,
  isVAT,
  ibanLocales,
};

export default validator;
