/**
 * Saying how much room something takes.
 *
 * Small, and worth testing anyway: a size shown wrongly is worse than no size
 * at all, because somebody will act on it.
 */
const { human } = require('../ui/src/renderer/bytes');

let pass = 0, fail = 0;
const check = (n, ok) => { ok ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n)); };

const K = 1024;
const M = K * K;
const G = M * K;

console.log('the brackets:');
{
  check('bytes', human(512) === '512 B');
  check('kilobytes', human(2 * K) === '2.0 KB');
  check('megabytes', human(5 * M) === '5.0 MB');
  check('gigabytes', human(3 * G) === '3.0 GB');
  // Windows shows 1024-based sizes for a folder, so this has to agree with what
  // a person sees in Explorer beside it.
  check('a thousand bytes is still bytes', human(1000) === '1000 B');
  check('and 1024 is a kilobyte', human(K) === '1.0 KB');
}

console.log('\nhow precise:');
{
  check('a tenth below ten', human(9.4 * M) === '9.4 MB');
  check('and none above it', human(412.7 * M) === '413 MB');
  check('so a column of sizes lines up', human(479 * M) === '479 MB');
}

console.log('\nthe edge that rounds into the next bracket:');
{
  // 1023.6 MB would print as "1024 MB", which is a gigabyte spelled wrong.
  check('just under a gigabyte does not print as 1024 MB',
        human(1023.6 * M) === '1.0 GB');
  check('and just under a megabyte does not print as 1024 KB',
        human(1023.7 * K) === '1.0 MB');
}

console.log('\nnothing, and nonsense:');
{
  check('zero', human(0) === '0 B');
  check('nothing at all', human(undefined) === '0 B');
  check('not a number', human('big') === '0 B');
  check('and a negative size is not a size', human(-5) === '0 B');
}

console.log('\nthe real folder this was written for:');
{
  // Nine recordings, 479 MB - the measurement that prompted it.
  check('reads the way a person would say it', human(502316482) === '479 MB');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
