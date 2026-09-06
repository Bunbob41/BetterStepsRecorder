/**
 * Headings that group a recording into phases.
 *
 * A long procedure is not a flat list of forty clicks. It is "get the file
 * ready", then "put it through the system", then "file the paperwork" - and a
 * reader who cannot see those joins has to hold the whole thing in their head.
 * Every SOP format we support has section headings; nothing in the recording
 * could produce one.
 *
 * A heading is a NOTE WITH A RANK, not a property of the step below it. That
 * choice matters: as a row it inherits insertion, drag-to-reorder, delete,
 * exclude and authored-text-is-never-rewritten from the machinery notes
 * already use. As a property it would die with the step that carried it, which
 * is exactly what happens when someone re-records a step.
 *
 * One level. The number of sections is whatever the procedure needs, but they
 * do not nest: an ISO template gets its 5.1/5.2 hierarchy from the template's
 * own structure, and a second hierarchy from us would fight it. `level` exists
 * on the data so nesting can arrive later without a migration, and is not
 * surfaced.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BsrSections = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const isSection = (s) => Boolean(s) && s.action === 'section';
  const isNote = (s) => Boolean(s) && s.action === 'note';

  /** A row the reader counts. Notes and headings are written, not recorded. */
  const isStep = (s) => Boolean(s) && !isSection(s) && !isNote(s);

  /** How many numbered steps a list of rows carries. */
  const countSteps = (steps) => (steps || []).filter(isStep).length;

  /**
   * Where a heading probably belongs: the points where the recording moved to
   * a different application.
   *
   * This is a suggestion, never an edit. Sectioning is an authoring judgement -
   * a procedure can change phase without changing program, and can switch
   * program mid-phase - so the tool points at the joins it can see and leaves
   * the decision alone.
   *
   * Returns the indices to insert BEFORE. A boundary is skipped when a heading
   * already sits there (accepting one must make its own suggestion go away) or
   * when the author has dismissed it.
   */
  function suggestions(steps) {
    const list = steps || [];
    const out = [];

    let previousApp = null;
    // Whether a heading has appeared since the last recorded step, so an
    // accepted suggestion stops suggesting itself.
    let headed = false;

    list.forEach((s, index) => {
      if (isSection(s)) { headed = true; return; }
      if (!isStep(s)) return;

      const app = (s.window && s.window.process) || '';

      // Not before the first step: "nothing, then Chrome" is not a change of
      // application, and a heading above step one is the document's title.
      if (previousApp !== null && app && app !== previousApp
          && !headed && !s.noSection) {
        out.push({ index, id: s.id, app });
      }

      if (app) previousApp = app;
      headed = false;
    });

    return out;
  }

  /**
   * Drops headings with nothing underneath.
   *
   * Run on the list that is actually being exported, so a section whose every
   * step was excluded disappears with them. A heading over nothing is a promise
   * the document does not keep, and the reader spends their time looking for
   * the part that was cut.
   */
  function withoutEmpty(steps) {
    const list = steps || [];
    return list.filter((s, i) => {
      if (!isSection(s)) return true;
      const next = list[i + 1];
      return Boolean(next) && !isSection(next);
    });
  }

  /**
   * The heading each row falls under, by row index, so a template can print the
   * section beside a step without tracking it itself. '' before the first one.
   */
  function sectionOf(steps) {
    const list = steps || [];
    const out = new Array(list.length).fill('');
    let current = '';
    list.forEach((s, i) => {
      if (isSection(s)) { current = (s.text || '').trim(); out[i] = current; return; }
      out[i] = current;
    });
    return out;
  }

  /** Whether a guide has any headings, which decides its heading levels. */
  const hasSections = (steps) => (steps || []).some(isSection);

  return { isSection, isNote, isStep, countSteps, suggestions,
           withoutEmpty, sectionOf, hasSections };
}));
