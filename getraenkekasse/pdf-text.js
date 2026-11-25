"use strict";
const characterSets = new WeakMap();

function supported(text, font) {
  if (!characterSets.has(font)) characterSets.set(font, new Set(font.getCharacterSet()));
  const characters = characterSets.get(font);
  return Array.from(String(text ?? "").replace(/\s+/g, " ").trim()).map(letter =>
    characters.has(letter.codePointAt(0)) ? letter : "□").join("");
}
function linesFor(text, font, size, maxWidth) {
  const words = supported(text, font).split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    const joined = line ? line + " " + word : word;
    if (font.widthOfTextAtSize(joined, size) <= maxWidth) {
      line = joined;
      continue;
    }
    if (line) lines.push(line);
    line = "";
    for (const letter of word) {
      if (line && font.widthOfTextAtSize(line + letter, size) > maxWidth) {
        lines.push(line);
        line = "";
      }
      line += letter;
    }
  }
  return [...lines, line];
}
module.exports = {supported, linesFor};
