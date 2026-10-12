// Text that other players see: names, clues and chat. Strips control,
// zero-width and bidi-override characters (but keeps the ZWJ inside emoji
// sequences), collapses whitespace and cuts at grapheme boundaries so a
// family emoji or an accented letter is never split in half.
const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

// C0/C1 controls, bidi embeddings/overrides/isolates, zero-width space and
// joiners other than ZWJ, word joiner, BOM and the soft hyphen.
const INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F­؜᠎​‌‎‏‪-‮⁠-⁤⁦-⁯﻿￹-￻]/g;

function graphemes(text) {
  return segmenter ? [...segmenter.segment(text)].map((part) => part.segment) : Array.from(text);
}

// A ZWJ is only kept between two visible characters (emoji sequences).
function dropLooseJoiners(text) {
  return text.replace(/(^|\s)‍+|‍+(?=\s|$)/g, '$1').replace(/‍{2,}/g, '‍');
}

function cleanText(value, maxGraphemes, { maxBytes = maxGraphemes * 16 } = {}) {
  if (typeof value !== 'string') return '';
  let text = dropLooseJoiners(value.normalize('NFC').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim());
  const parts = graphemes(text);
  if (parts.length > maxGraphemes) text = parts.slice(0, maxGraphemes).join('').trim();
  // A single "grapheme" can carry thousands of combining marks: cap bytes too.
  while (Buffer.byteLength(text) > maxBytes) {
    const list = graphemes(text);
    list.pop();
    text = list.join('').trim();
  }
  return text;
}

module.exports = { cleanText, graphemes };
