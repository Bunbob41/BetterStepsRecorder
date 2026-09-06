/**
 * Authors templates/corporate-sop.docx.
 *
 * A .docx is a zip of XML parts, so this writes the minimum Word will open: a
 * content-type map, a package relationship, and the document body. It exists so
 * the repository carries a working Word template that can be opened, edited and
 * re-saved in Word like any other document - the placeholders are ordinary text.
 *
 * Run: node scripts/make-docx-template.js
 */
const fs = require('node:fs');
const path = require('node:path');
const JSZip = require(path.join(__dirname, '..', 'ui', 'node_modules', 'jszip'));

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A paragraph. `style` maps to one of the styles defined below. */
function p(text, { style = null, bold = false, italic = false, spacing = 120 } = {}) {
  const pr = [
    style ? `<w:pStyle w:val="${style}"/>` : '',
    `<w:spacing w:after="${spacing}"/>`,
  ].join('');
  const rpr = (bold || italic)
    ? `<w:rPr>${bold ? '<w:b/>' : ''}${italic ? '<w:i/>' : ''}</w:rPr>`
    : '';
  return `<w:p><w:pPr>${pr}</w:pPr><w:r>${rpr}`
       + `<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
}

function table(rows) {
  const cell = (t, bold) =>
    `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>`
    + `<w:p><w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}`
    + `<w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p></w:tc>`;
  const body = rows.map((r, i) =>
    `<w:tr>${r.map((c) => cell(c, i === 0)).join('')}</w:tr>`).join('');
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/>`
       + `<w:tblW w:w="0" w:type="auto"/><w:tblBorders>`
       + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
           .map((s) => `<w:${s} w:val="single" w:sz="4" w:color="BFBFBF"/>`).join('')
       + `</w:tblBorders></w:tblPr>${body}</w:tbl>`;
}

const body = [
  p('Corporate Standard Operating Procedure', { style: 'Title' }),

  p('DOCUMENT METADATA', { style: 'Heading1' }),
  p('SOP Name: {{title}}'),
  p('Document ID: {{doc_id}}'),
  p('Version: 1.0 (Generated)'),
  p('Effective Date: {{timestamp}}'),
  p('System / Application: {{target_app}}'),
  p('Organisation: {{organisation}}'),

  p('1. CONTEXT', { style: 'Heading1' }),
  p('1.1 Purpose', { style: 'Heading2' }),
  p('This procedure defines the sequence of actions captured during the target '
    + 'process execution, to ensure consistency and compliance across the '
    + 'organisation.'),
  p('1.2 Roles & Responsibilities', { style: 'Heading2' }),
  p('Primary Performer: {{user_id}}'),
  p('System Environment: {{os_environment}}'),

  p('2. CONTENT', { style: 'Heading1' }),
  p('2.1 Prerequisites', { style: 'Heading2' }),
  p('Ensure you have the credentials and environment configuration required by '
    + 'the target application before you begin.'),
  p('2.2 Step-by-Step Instructions', { style: 'Heading2' }),

  // The repeated block. Everything between FOR and END-FOR is emitted per step.
  //
  // Two branches, because a heading is not a step: it takes the document's own
  // Heading3 style so an author's phases sit inside this template's numbering
  // rather than being printed as another bold line of body text.
  p('{{FOR s IN steps}}'),
  p('{{IF $s.isSection}}'),
  p('{{$s.description}}', { style: 'Heading3' }),
  p('{{END-IF}}'),
  p('{{IF !$s.isSection}}'),
  p('{{$s.label}}{{$s.description}}', { bold: true, spacing: 60 }),
  p('{{IMAGE shot($s)}}', { spacing: 240 }),
  p('{{END-IF}}'),
  p('{{END-FOR s}}'),

  p('3. CONSISTENCY', { style: 'Heading1' }),
  p('3.1 Event Terminology', { style: 'Heading2' }),
  p('LEFT_CLICK / RIGHT_CLICK / DOUBLECLICK: mouse button pressed and released.'),
  p('DRAG: button held while the pointer moves between two points.'),
  p('KEYTEXT: a value typed into the focused field, recorded per field rather '
    + 'than per keystroke.'),
  p('KEYPRESS: a named key or a modifier chord.'),
  p('PASSWORD: typing occurred in a masked field; the contents were not recorded.'),

  p('4. COMPLIANCE', { style: 'Heading1' }),
  p('4.1 Security & Privacy', { style: 'Heading2' }),
  p('Applied to this recording: {{redaction_summary}}'),
  p('Password fields are suppressed at capture and their contents are never '
    + 'written to disk. Card and national-insurance shaped values typed into '
    + 'ordinary fields are masked automatically. Any further redaction is the '
    + "author's responsibility and is listed above."),

  p('4.2 Revision History', { style: 'Heading2' }),
  table([
    ['Version', 'Date', 'Description of Changes', 'Author'],
    ['1.0', '{{date}}', 'Captured procedure, {{step_count}} steps', '{{user_id}}'],
  ]),
  p(''),
  p('4.3 Approvals & Sign-Offs', { style: 'Heading2' }),
  p('Authorised Approver Signature: ___________________________'),
  p('Date: ___________________________'),
  p('{{footer}}', { italic: true }),
].join('');

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
            xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
            xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"
            xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
            xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing"
            xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
            xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main"
            mc:Ignorable="w14 wp14 a14">
  <w:body>${body}
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/>
    </w:sectPr>
  </w:body>
</w:document>`;

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr>
    <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/>
  </w:rPr></w:rPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/>
    <w:rPr><w:b/><w:sz w:val="44"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>
    <w:rPr><w:b/><w:sz w:val="30"/><w:color w:val="1F3864"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/>
    <w:pPr><w:spacing w:before="240" w:after="100"/><w:outlineLvl w:val="2"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="24"/><w:color w:val="1F4E79"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/>
    <w:rPr><w:b/><w:sz w:val="26"/><w:color w:val="2E5496"/></w:rPr></w:style>
  <w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/></w:style>
</w:styles>`;

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="jpg" ContentType="image/jpeg"/>
  <Default Extension="jpeg" ContentType="image/jpeg"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

(async () => {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', contentTypes);
  zip.folder('_rels').file('.rels', rootRels);
  const word = zip.folder('word');
  word.file('document.xml', documentXml);
  word.file('styles.xml', stylesXml);
  word.folder('_rels').file('document.xml.rels', docRels);

  const out = path.join(__dirname, '..', 'templates', 'corporate-sop.docx');
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(out, buf);
  console.log(`wrote ${out} (${buf.length} bytes)`);
})();
