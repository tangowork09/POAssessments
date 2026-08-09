/**
 * Generates src/worker/pdf/afm.ts — advance-width tables for the PDF base-14
 * Helvetica family, in 1/1000 em, indexed by WinAnsiEncoding code 32..255.
 *
 * Source metrics: Adobe AFM files, as redistributed by @react-pdf/pdfkit
 * (devDependency, build-time only — nothing from it ships to the Worker).
 *
 * Run: node scripts/gen-afm.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const VARIANTS = {
  'Helvetica': 'Helvetica.js',
  'Helvetica-Bold': 'HelveticaBold.js',
  'Helvetica-Oblique': 'HelveticaOblique.js',
  'Helvetica-BoldOblique': 'HelveticaBoldOblique.js',
};

// WinAnsiEncoding: code -> glyph name (PDF 1.7 spec, Annex D.2)
const ASCII =
  'space exclam quotedbl numbersign dollar percent ampersand quotesingle parenleft parenright ' +
  'asterisk plus comma hyphen period slash zero one two three four five six seven eight nine ' +
  'colon semicolon less equal greater question at A B C D E F G H I J K L M N O P Q R S T U V W X Y Z ' +
  'bracketleft backslash bracketright asciicircum underscore grave ' +
  'a b c d e f g h i j k l m n o p q r s t u v w x y z braceleft bar braceright asciitilde';

const HIGH = {
  128: 'Euro', 130: 'quotesinglbase', 131: 'florin', 132: 'quotedblbase', 133: 'ellipsis',
  134: 'dagger', 135: 'daggerdbl', 136: 'circumflex', 137: 'perthousand', 138: 'Scaron',
  139: 'guilsinglleft', 140: 'OE', 142: 'Zcaron', 145: 'quoteleft', 146: 'quoteright',
  147: 'quotedblleft', 148: 'quotedblright', 149: 'bullet', 150: 'endash', 151: 'emdash',
  152: 'tilde', 153: 'trademark', 154: 'scaron', 155: 'guilsinglright', 156: 'oe',
  158: 'zcaron', 159: 'Ydieresis', 160: 'space', 161: 'exclamdown', 162: 'cent',
  163: 'sterling', 164: 'currency', 165: 'yen', 166: 'brokenbar', 167: 'section',
  168: 'dieresis', 169: 'copyright', 170: 'ordfeminine', 171: 'guillemotleft', 172: 'logicalnot',
  173: 'hyphen', 174: 'registered', 175: 'macron', 176: 'degree', 177: 'plusminus',
  178: 'twosuperior', 179: 'threesuperior', 180: 'acute', 181: 'mu', 182: 'paragraph',
  183: 'periodcentered', 184: 'cedilla', 185: 'onesuperior', 186: 'ordmasculine',
  187: 'guillemotright', 188: 'onequarter', 189: 'onehalf', 190: 'threequarters',
  191: 'questiondown', 192: 'Agrave', 193: 'Aacute', 194: 'Acircumflex', 195: 'Atilde',
  196: 'Adieresis', 197: 'Aring', 198: 'AE', 199: 'Ccedilla', 200: 'Egrave', 201: 'Eacute',
  202: 'Ecircumflex', 203: 'Edieresis', 204: 'Igrave', 205: 'Iacute', 206: 'Icircumflex',
  207: 'Idieresis', 208: 'Eth', 209: 'Ntilde', 210: 'Ograve', 211: 'Oacute', 212: 'Ocircumflex',
  213: 'Otilde', 214: 'Odieresis', 215: 'multiply', 216: 'Oslash', 217: 'Ugrave', 218: 'Uacute',
  219: 'Ucircumflex', 220: 'Udieresis', 221: 'Yacute', 222: 'Thorn', 223: 'germandbls',
  224: 'agrave', 225: 'aacute', 226: 'acircumflex', 227: 'atilde', 228: 'adieresis', 229: 'aring',
  230: 'ae', 231: 'ccedilla', 232: 'egrave', 233: 'eacute', 234: 'ecircumflex', 235: 'edieresis',
  236: 'igrave', 237: 'iacute', 238: 'icircumflex', 239: 'idieresis', 240: 'eth', 241: 'ntilde',
  242: 'ograve', 243: 'oacute', 244: 'ocircumflex', 245: 'otilde', 246: 'odieresis', 247: 'divide',
  248: 'oslash', 249: 'ugrave', 250: 'uacute', 251: 'ucircumflex', 252: 'udieresis',
  253: 'yacute', 254: 'thorn', 255: 'ydieresis',
};

const encoding = {};
ASCII.split(' ').forEach((n, i) => { encoding[32 + i] = n; });
Object.assign(encoding, HIGH);

const base = path.resolve('node_modules/@react-pdf/pdfkit/lib/standard-fonts');
const out = {};
for (const [name, file] of Object.entries(VARIANTS)) {
  const mod = (await import(path.join(base, file))).default;
  const glyphNames = mod.glyphNames.split(' ');
  const byName = Object.create(null);
  glyphNames.forEach((g, i) => { byName[g] = mod.glyphWidths[i]; });
  const widths = [];
  for (let c = 32; c <= 255; c++) {
    const g = encoding[c];
    widths.push(g != null && byName[g] != null ? byName[g] : 0);
  }
  out[name] = widths;
}

let ts = `// GENERATED FILE — do not edit. Run \`node scripts/gen-afm.mjs\` to regenerate.
//
// Advance widths for the PDF base-14 Helvetica family, expressed in 1/1000 em,
// indexed by WinAnsiEncoding character code starting at FIRST_CHAR (32).
// Source: Adobe Systems AFM metrics.
// Copyright (c) 1985, 1987, 1989, 1990, 1997 Adobe Systems Incorporated.
// Helvetica is a trademark of Linotype-Hell AG and/or its subsidiaries.

export type StdFont = ${Object.keys(out).map((k) => JSON.stringify(k)).join(' | ')};

export const FIRST_CHAR = 32;
export const LAST_CHAR = 255;

export const WIDTHS: Record<StdFont, readonly number[]> = {
`;
for (const [k, v] of Object.entries(out)) ts += `  ${JSON.stringify(k)}: [${v.join(',')}],\n`;
ts += '};\n';

fs.mkdirSync('src/worker/pdf', { recursive: true });
fs.writeFileSync('src/worker/pdf/afm.ts', ts);
console.log('wrote src/worker/pdf/afm.ts', fs.statSync('src/worker/pdf/afm.ts').size, 'bytes');
