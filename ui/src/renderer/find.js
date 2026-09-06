/**
 * Finding and replacing words across a whole recording.
 *
 * A recording is written once and read for years. The system it documents gets
 * renamed, a team changes, a button's label changes - and without this the
 * choice is retyping forty steps by hand or letting the guide go stale, which
 * in practice means letting it go stale.
 *
 * The matching is separated from the applying so the awkward parts can be
 * tested without a window: a query is a literal string and not a pattern, so
 * someone searching for "(draft)" or "a.b" finds exactly that; whole-word has
 * to mean word, not substring; and replacing must count what it did so the
 * author is told rather than left guessing.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BsrFind = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  /**
   * A literal string as a regular expression.
   *
   * Everything a person is likely to search for in a procedure - "(draft)",
   * "step 1.", "C:\\Users", "a+b" - is made of characters a regex treats as
   * syntax. Without this, searching for "(" throws and searching for "." finds
   * every character in the recording.
   */
  const escape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /**
   * The expression for a query. `wholeWord` uses lookarounds rather than \b so
   * it still works for a query that starts or ends with punctuation, where \b
   * anchors to the wrong side and matches nothing.
   */
  function pattern(query, { caseSensitive = false, wholeWord = false } = {}) {
    if (!query) return null;
    const body = escape(query);
    const bounded = wholeWord ? `(?<![\\w])${body}(?![\\w])` : body;
    return new RegExp(bounded, caseSensitive ? 'g' : 'gi');
  }

  /** How many times the query appears in one string. */
  function countIn(text, query, opts) {
    const re = pattern(query, opts);
    if (!re) return 0;
    const m = String(text == null ? '' : text).match(re);
    return m ? m.length : 0;
  }

  /**
   * Every row whose text contains the query, with how many times.
   *
   * Rows, not steps: a note and a heading are text a reader sees, so a rename
   * that skipped them would leave the guide contradicting itself.
   */
  function matches(steps, query, opts) {
    const out = [];
    if (!query) return out;
    (steps || []).forEach((step, index) => {
      const count = countIn(step && step.text, query, opts);
      if (count) out.push({ id: step.id, index, count, text: step.text });
    });
    return out;
  }

  /** The same text with every occurrence replaced. */
  function replaced(text, query, replacement, opts) {
    const re = pattern(query, opts);
    if (!re) return String(text == null ? '' : text);
    // A function, so `$&` and friends in the replacement are inserted as typed
    // rather than being expanded - somebody replacing a price with "$5" means
    // "$5".
    return String(text == null ? '' : text).replace(re, () => String(replacement ?? ''));
  }

  /**
   * What a replace-all would do: one entry per row that changes.
   *
   * Computed before anything is written, so the count shown to the author is
   * the count that will actually be applied, and so a replacement that changes
   * nothing can be refused rather than filling the undo history with a no-op.
   */
  function plan(steps, query, replacement, opts) {
    const changes = [];
    for (const hit of matches(steps, query, opts)) {
      const step = steps[hit.index];
      const text = replaced(step.text, query, replacement, opts);
      // "Save" -> "Save" is not a change, and neither is a case-insensitive
      // match that produces the identical string.
      if (text !== step.text) {
        changes.push({ id: step.id, index: hit.index, was: step.text, text,
                       count: hit.count });
      }
    }
    return changes;
  }

  /** A sentence for the author: what happened, in rows and occurrences. */
  function describe(changes) {
    const rows = changes.length;
    if (!rows) return 'Nothing to replace.';
    const hits = changes.reduce((n, c) => n + c.count, 0);
    const h = `${hits} occurrence${hits === 1 ? '' : 's'}`;
    const r = `${rows} step${rows === 1 ? '' : 's'}`;
    return `Replaced ${h} in ${r}.`;
  }

  return { escape, pattern, countIn, matches, replaced, plan, describe };
}));
