/**
 * The comparator shared by both differential harnesses.
 *
 * `diff.mjs` walks read endpoints; `write-diff.mjs` drives a scripted sequence
 * of writes. They must agree on what counts as a difference and on which
 * differences are allowed, so the engine and the ignore list live here rather
 * than in either caller.
 *
 * # Reading the ignore list
 *
 * Every entry says WHY, because an ignore list without reasons becomes a place
 * to hide failures. A path matcher is deliberately blunt — a regex over the
 * dotted path — so that adding an exception is visible in review.
 *
 * Numeric exceptions carry a `maxDelta` and it is ENFORCED. The first version of
 * this file had an entry whose reason ended "Bounded: anything beyond a few
 * cents is a real defect and still reported" — and nothing in the code bounded
 * anything, because `expected()` matched on path alone. A rounding exception
 * without a magnitude is an unlimited exception on that field: a genuine
 * hundred-dollar defect on `totalInterestPaid` would have been filtered out by
 * the entry that promised to catch it. That is precisely the "place to hide
 * failures" this list is supposed not to be.
 */

const EXPECTED = [
  {
    path: /(^|\.)(createdAt|updatedAt|completedAt|archivedAt)$/,
    why:
      'timestamps: the two databases were written at different moments. In the ' +
      'write harness the two calls are milliseconds apart by construction, ' +
      'which is what `archivedAt` was added for.',
  },
  {
    path: /^transactionIds\[\d+\]$/,
    why:
      'a purchase create returns the ids it minted, and each backend mints its ' +
      'own. Only ids the scenario BOUND are normalized, and these are not bound ' +
      'individually — but the array length is still compared, so a split that ' +
      'produced the wrong NUMBER of rows still reports.',
  },
  {
    path: /^anticipations\[[^\]]*\]\.(occurrenceDate|sourceId|sourceType|name|amount|accountId|frequency|status|budgetId|isAutomatic|expenseId|incomeId|id)$/,
    why:
      'ORDER, not content — verified: the two carry the same set of ' +
      'occurrenceDates with no length difference, so these report because the ' +
      'lists are paired positionally. The reference issues its anticipation ' +
      '`findMany` with NO `orderBy` at all, so its order is whatever Postgres ' +
      'returns — in practice insertion order, which puts every generated ' +
      'expense row before every income row. The port orders by ' +
      '`dueDate ASC, id ASC`. Matching the reference here would mean ' +
      'reproducing an accident: an unspecified order is not a contract, and ' +
      'the tie it leaves open is the same non-total ordering that made the ' +
      'transaction list reshuffle between renders. Nothing rendered depends on ' +
      'it either way — `sortTransactionLog` re-sorts every entry by date on the ' +
      'frontend before display. Kept deterministic on purpose.',
  },
  {
    path: /^details\.length$/,
    route: '/budgets',
    why:
      'serde stops at the first bad field; Zod reports every one. A body with ' +
      'two faults yields one detail here and two there. Collecting them all in ' +
      'Rust would mean deserializing field-by-field against a schema the struct ' +
      'definition already expresses — so the FIRST fault is reported accurately, ' +
      'which is what the form needs to highlight something real, and the count ' +
      'is allowed to differ. Only the length: the field NAMES are still compared, ' +
      'and those were wrong (every one said "body") until the shared `body_of`.',
  },
  {
    path: /(^|\.)id$/,
    why: 'ids are minted per-row on import; identity is positional here, not literal',
  },
  {
    path: /(^|\.)groupId$/,
    route: '/budgets',
    why:
      'the INSURANCE budget group is created ON DEMAND by the first insurance ' +
      'policy, so each backend mints its own id for it and the scenario cannot ' +
      'bind an id that does not exist until a later step creates it. Safe to ' +
      'excuse only because `groupName` is a sibling field on the same row and is ' +
      'still compared — a budget filed under the WRONG group still reports, ' +
      'which is the thing the id was standing in for.',
  },
  {
    path: /(^|\.)(safetyBackupId|importedBackupId|uploadId)$/,
    why: 'ids minted by the request itself',
  },
  {
    path: /^details\[\d+\]\.message$/,
    why:
      "the wording of a validation message, where the reference's comes from " +
      "Zod's built-in English and the port writes its own. `details[].field` " +
      'is NOT excused and is still compared — the field name is what identifies ' +
      'the bad input, and getting it wrong is a real defect. Requiring the port ' +
      "to reproduce a JavaScript library's prose verbatim would mean copying " +
      'its quirks too: a missing `date` reads "Invalid date" only because ' +
      '`z.coerce.date()` coerces `undefined` before checking, where the port ' +
      'says "is required". Messages the reference AUTHORS (rather than inherits ' +
      'from Zod) are matched exactly — see the purchase-split legs, where both ' +
      'sides say "payment legs must sum to the amount 100.00 (got 60.00)".',
  },
  {
    path: /(^|\.)(filepath|filename)$/,
    why: 'backup paths differ by data directory, which is the point of the sidecar',
  },
  {
    path: /^(totalPrincipalPaid|totalInterestPaid)$/,
    maxDelta: 0.05,
    why:
      'a sum of many payments: the reference adds float64 columns and rounds ' +
      'once, this adds integer cents. They differ by a cent, and the cents ' +
      'answer is the correct one — ERRORS.md records that 769 production money ' +
      'values already hold sub-cent float noise written through Prisma, so the ' +
      'reference is summing contaminated inputs.',
  },
  {
    path: /^(totalInterest|totalPayments)$/,
    maxDelta: 1,
    why:
      'amortization totals, same cause as the entry below and the same ~0.2c ' +
      'per period, accumulated over a 598-period mortgage rather than one row.',
  },
  {
    path: /^entries\[\d+\]\.(remainingBalance|principalAmount|interestAmount|paymentAmount)$/,
    maxDelta: 1,
    why:
      'amortization arithmetic differs BY DESIGN: the TypeScript runs the loop ' +
      'in unrounded f64 and rounds per entry, so its own totals disagree with ' +
      'its own rows; the cents port is internally consistent. Measured at max ' +
      '37c over a 598-period mortgage (~0.2c per period) and pinned by ' +
      'amort_differential.rs, which MEASURES the divergence rather than ' +
      'asserting equality.',
  },
  {
    route: '/investments/portfolio-history',
    path: /^entries\[\d+\]\.totalValue$/,
    maxDelta: 0.01,
    why:
      'ADR-033 decided this one explicitly and measured it. InvestmentSnapshot' +
      '.value is a dollar market value derived as quantity x unitPrice, and ALL ' +
      '724 production rows store it unrounded at up to 16dp. The reference SUMs ' +
      'those raw values; the port SUMs integer cents, so it is round-then-sum ' +
      'against exact-then-round. The ADR measured the whole-portfolio gap at ' +
      'ONE CENT over 724 rows and chose cents anyway. Observed here: 78 entries, ' +
      'max 0.0097, none reaching a cent — so the bound is a cent, and a real ' +
      'defect in the SUM would clear it easily.',
  },
  {
    route: '/dashboard/income-trend',
    path: /^\[\d+\]\.budgetExpenses$/,
    maxDelta: 0.02,
    why:
      'a projection built by division, which ADR-033 names as the ONE operation ' +
      'integer cents cannot make exact. The reference prorates each budget as ' +
      '`(monthlyEquivalent * 12) / periodsPerYear` in unrounded f64, sums, and ' +
      'rounds once; the port rounds each budget to the cent and sums. Observed ' +
      'max 0.01 across every period. Not corrected in favour of the reference: ' +
      "QUALITY.md's own rule prefers rounding at computation time for dashboard " +
      'aggregations, so the port has the better of the two and this is the cost.',
  },
  {
    route: '/dashboard/spend-prediction',
    path: /^(expectedPeriodSpend|overUnderAmount|dailyData\[\d+\]\.expectedCumulative)$/,
    maxDelta: 0.05,
    why:
      'same cause as income-trend and compounded twice more: the prorated budget ' +
      'is divided again by the day count for a daily rate, then multiplied back ' +
      'up per day. Observed max 0.0262 on a $3,813 projection. A prediction is ' +
      'display-only by construction — nothing is written from it.',
  },
  {
    route: '/connected-services',
    path: /^\[\d+\]\.(configured|hint|source|updatedAt)$/,
    why:
      "ADR-035's explicitly accepted cost, not a divergence to fix. Dropping the " +
      'AES layer meant the one production ciphertext (finnhub, hint `po60`) could ' +
      'not be carried across — decrypting needs the key and a migration is SQL. ' +
      'The row survives with `secret = NULL`, reads as unconfigured, and is ' +
      'overwritten by the next save. So the reference reports the key it can ' +
      'still decrypt and the port reports the truth about its own database.',
  },
  {
    route: '/backups',
    path: /^\.length$|^\[id=/,
    why:
      'the harness creates this one itself. The Rust sidecar takes a SCHEDULED ' +
      'backup when one is due, and the throwaway SQLite it is pointed at has no ' +
      'prior backup, so one runs at launch. The TypeScript backend has no such ' +
      'feature — backups are a v0.9 desktop capability. An artifact of observing ' +
      'the system, not a difference between the two implementations.',
  },
];

/**
 * Whether a difference is one of the allowed ones.
 *
 * Three narrowings, each of which exists because a broader match would excuse
 * something it was never meant to:
 *
 * - `route`, when set, pins the entry to one endpoint. Field names repeat across
 *   a REST API — `entries[]` is amortization on one route and portfolio history
 *   on another — and an exception earned by one is not earned by the other.
 * - `maxDelta` bounds a numeric entry. Past the bound the same field on the same
 *   route reports as a defect, which is the entire point of writing a number
 *   down instead of a sentence about one.
 * - entries with neither cover non-numeric divergence (ids, paths, timestamps)
 *   where magnitude is meaningless.
 */
const expected = (d, route) => {
  const e = EXPECTED.find(
    (x) => (x.route === undefined || x.route === route) && x.path.test(d.path),
  );
  if (!e) return null;
  if (e.maxDelta === undefined) return e;
  if (typeof d.ts !== 'number' || typeof d.rs !== 'number') return null;
  return Math.abs(d.ts - d.rs) <= e.maxDelta ? e : null;
};

/** Every leaf difference between two values, as dotted paths. */
function diff(a, b, path = '', out = []) {
  if (Object.is(a, b)) return out;

  const ta = Array.isArray(a) ? 'array' : a === null ? 'null' : typeof a;
  const tb = Array.isArray(b) ? 'array' : b === null ? 'null' : typeof b;

  if (ta !== tb) {
    out.push({ path, ts: a, rs: b, kind: 'type' });
    return out;
  }

  if (ta === 'array') {
    if (a.length !== b.length) {
      out.push({ path: `${path}.length`, ts: a.length, rs: b.length, kind: 'length' });
    }

    // Match by id where the elements have one, rather than by position.
    //
    // Both backends order `/scheduled-transactions` by `dueDate ASC`, and
    // neither defines a tie-break — so Postgres and SQLite return same-date
    // rows in different orders, which is arbitrary in both and a defect in
    // neither. Compared positionally that produced 801 differences on one
    // route and MASKED whatever real differences sat underneath: every field
    // of every row after the first tie reads as wrong.
    //
    // (The unstable order is worth fixing on its own — a list whose rows
    // shuffle between requests is a UI defect — but it is a separate change
    // from being able to see through it.)
    // `id` is not the only identity field the API uses. `/dashboard/ytd`'s
    // `byCategory` rows carry `budgetId` and no `id`, and two of them with equal
    // totals came back in opposite orders — the same tie, one row lower down.
    // Candidates are tried in order and the first one every element carries wins.
    const ID_FIELDS = ['id', 'budgetId'];
    const keyOf = (arr) => {
      if (arr.length === 0) return null;
      const objects = arr.every((x) => x && typeof x === 'object' && !Array.isArray(x));
      if (!objects) return null;
      return ID_FIELDS.find((k) => arr.every((x) => typeof x[k] === 'string')) ?? null;
    };

    // An identity key only identifies rows the two sides SHARE a value on.
    //
    // In the read harness they share all of them: both databases come from one
    // export, so a row has the same id on both. In the write harness they share
    // almost none — each backend mints its own cuids — and the few they do share
    // are the ones the scenario bound and normalized to `<name>`. Keying on `id`
    // there puts every unbound row in a group of one and reports the same five
    // descriptions as five missing and five extra.
    //
    // So rows are matched by key WHERE THE KEY MATCHES, and whatever is left
    // over on each side is then paired POSITIONALLY. Both regimes come out
    // right: everything matches by id in the read harness, while in the write
    // harness the bound rows match by id and the independently-minted ones pair
    // up in order. A row that is genuinely absent still reports, because it
    // leaves nothing on the other side to pair with — and the length difference
    // is recorded above regardless.
    const key = keyOf(a);
    if (key !== null && key === keyOf(b)) {
      // An id is not necessarily UNIQUE within a response. `/dashboard/current-
      // period` lists one entry per OCCURRENCE, so a weekly expense appears four
      // or five times carrying the same expense id and differing only by due
      // date. The first version of this used `new Map(b.map(...))`, which keeps
      // the last of each duplicate and silently discards the rest: the same id
      // then reported as BOTH a value difference and missing-in-rust, which is
      // not a describable state and was the tell.
      //
      // So: group by id, then pair within each group by position. Identity comes
      // from the id (immune to the ordering noise below), and the remaining
      // ambiguity between same-id siblings is resolved the only way left.
      const group = (arr) => {
        const m = new Map();
        for (const x of arr) {
          if (!m.has(x[key])) m.set(x[key], []);
          m.get(x[key]).push(x);
        }
        return m;
      };
      const ga = group(a);
      const gb = group(b);

      // Whatever the key cannot pair up, in the order it appeared.
      const restA = [];
      const restB = [];

      for (const [k, xs] of ga) {
        const ys = gb.get(k) ?? [];
        for (let i = 0; i < Math.max(xs.length, ys.length); i++) {
          // Only disambiguate in the path when there really are siblings —
          // otherwise every path grows a `#0` that means nothing.
          const sib = xs.length > 1 || ys.length > 1 ? `#${i}` : '';
          const at = `${path}[${key}=${k}${sib}]`;
          if (i >= ys.length) restA.push({ at, v: xs[i] });
          else if (i >= xs.length) restB.push({ at, v: ys[i] });
          else diff(xs[i], ys[i], at, out);
        }
        gb.delete(k);
      }
      for (const [k, ys] of gb) {
        for (const y of ys) restB.push({ at: `${path}[${key}=${k}]`, v: y });
      }

      for (let i = 0; i < Math.max(restA.length, restB.length); i++) {
        if (i >= restB.length) {
          out.push({ path: restA[i].at, ts: restA[i].v, rs: undefined, kind: 'missing-in-rust' });
        } else if (i >= restA.length) {
          out.push({ path: restB[i].at, ts: undefined, rs: restB[i].v, kind: 'only-in-rust' });
        } else {
          // Two rows neither side could key against the other: compared in
          // order, on the assumption they are the same row with different
          // per-backend ids. If they are not, their FIELDS will say so.
          diff(restA[i].v, restB[i].v, restA[i].at, out);
        }
      }
      return out;
    }

    for (let i = 0; i < Math.min(a.length, b.length); i++) diff(a[i], b[i], `${path}[${i}]`, out);
    return out;
  }

  if (ta === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const p = path ? `${path}.${k}` : k;
      if (!(k in a)) {
        // The class three of the six defects fell into: a field the client
        // reads as optional, absent from one side. Invisible to schema
        // validation, and visible here.
        out.push({ path: p, ts: undefined, rs: b[k], kind: 'only-in-rust' });
      } else if (!(k in b)) {
        out.push({ path: p, ts: a[k], rs: undefined, kind: 'missing-in-rust' });
      } else {
        diff(a[k], b[k], p, out);
      }
    }
    return out;
  }

  // Numbers: money is integer cents in Rust and float in TypeScript, so a
  // sub-cent difference is a representation artifact rather than a defect.
  // Anything larger is real and is reported.
  if (ta === 'number' && Math.abs(a - b) < 0.005) return out;

  out.push({ path, ts: a, rs: b, kind: 'value' });
  return out;
}

export { EXPECTED, expected, diff };
