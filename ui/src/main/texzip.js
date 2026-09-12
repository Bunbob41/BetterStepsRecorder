/**
 * One file to upload: the LaTeX document and its screenshots, zipped.
 *
 * Every other export is a file. This one cannot be - `\includegraphics` names a
 * file on disk and LaTeX has no such thing as an embedded picture - so a LaTeX
 * export is a document plus a folder, and the folder has to travel with it.
 *
 * Watched in Overleaf: two drags, and one rule nobody is told (keep the folder's
 * name, because the paths inside the document go through it). Get it wrong and
 * there is no error, just a stack of empty boxes where the screenshots were.
 * A zip removes the rule. Overleaf takes one as a whole new project, and
 * unpacks one dropped into an existing project.
 *
 * JSZip rather than a zip written by hand or a shell: it is already here, for
 * reading .docx templates, which are zips of XML. Nothing new is installed, and
 * nothing spawns powershell.exe on a machine whose security software is
 * watching a program that records the screen.
 */
const JSZip = require('jszip');

/**
 * Packs a document and its pictures into a zip, as bytes.
 *
 * `texName` is the document's name inside the zip, `imageDir` the folder the
 * document's `\includegraphics` paths go through. Both come from the caller
 * because both are already in the document's text: invent either here and the
 * paths stop matching the files, which is the one failure this exists to
 * prevent.
 */
async function buildZip({ tex, texName, imageDir, images }) {
  const zip = new JSZip();
  zip.file(texName, tex);

  const folder = zip.folder(imageDir);
  for (const [name, data] of images) folder.file(name, data);

  // STORE for the pictures, which are PNG or JPEG and already compressed:
  // deflating them again costs seconds on a recording of forty steps and saves
  // nothing. The document itself is text and worth compressing.
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    streamFiles: false,
  });
}

/**
 * Every picture the document asks for, and whether the zip has it.
 *
 * The failure this catches is silent in LaTeX: a path that names nothing
 * compiles to an empty box, and a reader sees a guide with holes in it rather
 * than an error. Cheap to check here, where both sides are in hand.
 */
function missingFrom(tex, imageDir, names) {
  const asked = [...tex.matchAll(/\\includegraphics\[[^\]]*\]\{([^}]+)\}/g)]
    .map((m) => m[1]);
  const have = new Set([...names].map((n) => `${imageDir}/${n}`));
  return asked.filter((ref) => !have.has(ref));
}

module.exports = { buildZip, missingFrom };
