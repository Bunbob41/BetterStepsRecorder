/**
 * The words a person sees when something could not be done.
 *
 * The export used to show the operating system's error as it came - "EBUSY:
 * resource busy or locked, open 'C:\...\guide.docx'" - which is accurate and
 * says nothing about what to do. These check that each common cause becomes a
 * sentence with a way out, and that the raw error never reaches the window.
 */
const { fileProblem } = require('../ui/src/main/messages');

let pass = 0, fail = 0;
const check = (n, ok, extra) => {
  if (ok) { pass++; console.log('  PASS ' + n); }
  else { fail++; console.log('  FAIL ' + n + (extra ? '  -> ' + extra : '')); }
};

const err = (code, message = `${code}: something, open 'C:\\Users\\You\\guide.docx'`) =>
  Object.assign(new Error(message), { code });

console.log('a file held open by another program:');
{
  const said = fileProblem(err('EBUSY'), { action: 'export the guide' });
  check('says what was being done', said.startsWith('Could not export the guide'), said);
  check('says why', /open in another program/.test(said), said);
  check('and what to do about it', /Close it there and try again/.test(said), said);
}

console.log('\nthe other common causes each say what to do:');
{
  check('protected or held open', /Close the file, or choose a different folder/.test(fileProblem(err('EPERM'))));
  check('not allowed to write there', /Choose a different folder/.test(fileProblem(err('EACCES'))));
  check('a full disk', /the disk is full/.test(fileProblem(err('ENOSPC'))));
  check('a folder that has gone', /no longer there/.test(fileProblem(err('ENOENT'))));
}

console.log('\nwhat never reaches the window:');
{
  for (const code of ['EBUSY', 'EPERM', 'EACCES', 'ENOSPC', 'ENOENT', 'EWHATEVER']) {
    const said = fileProblem(err(code));
    // The raw text carries a code and a full path; neither helps the person.
    check(`${code}: no error code and no path`, !/E[A-Z]{3,}|C:\\/.test(said), said);
  }
}

console.log('\nwhat is not known is not guessed at:');
{
  const said = fileProblem(err('EWHATEVER'), { action: 'save the photo' });
  check('an unfamiliar cause says where the details are', /The details are in the log/.test(said), said);
  check('as does no error at all', /The details are in the log/.test(fileProblem(undefined)));
  check('and the action defaults to something sensible', fileProblem(null).startsWith('Could not save the file'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
