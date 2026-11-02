// Control for a-unicode-space-before-a-number-makes-parseint-nan: the same strings with an ASCII space in each place.
observe("parseInt after a space", String(parseInt(" -7", 10)));
observe("parseFloat after a space", String(parseFloat(" 0.5")));
observe("parseInt after a space again", String(parseInt(" 7", 10)));
done();
