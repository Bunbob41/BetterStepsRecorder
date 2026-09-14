/**
 * What to tell a person when something they asked for could not be done.
 *
 * The window used to show an operating system error as it came - "EBUSY:
 * resource busy or locked, open 'C:\...\guide.docx'" - in a box that had to be
 * clicked away. Every word of that is true and none of it says what to do. The
 * raw error still goes to the log, where somebody diagnosing a problem wants
 * it; the person in front of the window gets the cause in plain words and the
 * one thing that fixes it.
 *
 * Pure of Electron, so each wording can be checked without a window.
 */

/**
 * A file or folder problem, described for the person who hit it.
 *
 * `action` is the thing they were doing, phrased to follow "Could not" -
 * "export the guide", "save the photo".
 */
function fileProblem(err, { action = 'save the file' } = {}) {
  const code = err && err.code;
  switch (code) {
    // Windows reports a file held open by another program as either of these,
    // and Word holding the .docx being exported over is the usual one.
    case 'EBUSY':
      return `Could not ${action}: the file is open in another program. Close it there and try again.`;
    case 'EPERM':
      return `Could not ${action}: the file may be open in another program, or the folder may be `
           + 'protected. Close the file, or choose a different folder.';
    case 'EACCES':
      return `Could not ${action}: Windows will not let this app write there. Choose a different folder.`;
    case 'ENOSPC':
      return `Could not ${action}: the disk is full. Free some space and try again.`;
    case 'ENOENT':
      return `Could not ${action}: that folder is no longer there. Choose another.`;
    default:
      // Unknown causes are not guessed at. The log has the real one.
      return `Could not ${action}. The details are in the log.`;
  }
}

module.exports = { fileProblem };
