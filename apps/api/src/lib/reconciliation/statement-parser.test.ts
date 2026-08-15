/**
 * Statement parser — format detection and per-format rules.
 *
 * The Cash Wallet cases are the point: its export carries rows that never moved
 * money (FAILED), rows in a different asset (BTC), and fee-bearing rows, and
 * getting any of them wrong turns a correct statement into a wall of false
 * discrepancies — the one outcome reconciliation exists to prevent.
 */
import { describe, it, expect } from 'vitest';
import { parseStatementCsv, StatementParseError } from './statement-parser.js';

const CASH_HEADER =
  '"Date","Transaction ID","Transaction Type","Currency","Amount","Fee","Net Amount","Asset Type","Asset Price","Asset Amount","Status","Notes","Name of sender/receiver","Account"';

/** Build a Cash Wallet CSV from row tuples, in the real column order. */
function cashApp(...rows: string[]): string {
  return [CASH_HEADER, ...rows].join('\n');
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

describe('parseStatementCsv — Cash Wallet format', () => {
  it('reads money out and money in with the sign as given', () => {
    const csv = cashApp(
      '"2026-07-21 11:41:58 CDT","#D-AAAA1111","P2P","USD","-$1,200.00","$0.00","-$1,200.00","","","","COMPLETE","Appliance Repair","Jordan Reyes","Cash Balance"',
      '"2026-07-08 10:52:31 CDT","","","USD","$3,400.00","$0.00","$3,400.00","","","","COMPLETE","ACME CORP PAYROLL","","Cash Balance"',
    );
    const { rows } = parseStatementCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ amount: -1200, description: 'Appliance Repair' });
    expect(rows[1]).toMatchObject({ amount: 3400, description: 'ACME CORP PAYROLL' });
  });

  it('uses Net Amount, not Amount, so a fee is included in what left the account', () => {
    const csv = cashApp(
      '"2026-06-15 18:16:17 CDT","","","USD","-$42.50","-$3.00","-$45.50","","","","COMPLETE","400 MARKET STREET","","Cash Balance"',
    );
    const { rows } = parseStatementCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amount).toBe(-45.5); // net, not the -42.50 pre-fee amount
  });

  it('drops rows that never happened (Status not COMPLETE)', () => {
    const csv = cashApp(
      '"2026-06-24 13:16:46 CDT","","Cash Card","USD","-$0.11","$0.00","-$0.11","","","","FAILED","RAZ*CITY CLINIC","","Cash Balance"',
      '"2026-06-15 18:16:02 CDT","","","USD","-$43.00","$0.00","-$43.00","","","","FAILED","400 MARKET STREET","","Cash Balance"',
      '"2026-07-03 14:55:43 CDT","","","USD","-$450.00","$0.00","-$450.00","","","","COMPLETE","CORNER CAFE","","Cash Balance"',
    );
    const { rows } = parseStatementCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amount).toBe(-450);
  });

  it('drops BTC-denominated rows but keeps a USD Bitcoin Buy', () => {
    const csv = cashApp(
      // BTC currency — moves the holding, not the cash balance.
      '"2026-02-14 20:25:34 CST","","Bitcoin Deposit","BTC","0.08","0","0.08","BTC","","","COMPLETE","Bitcoin Credit","","Cash Balance"',
      '"2026-04-07 08:18:08 CDT","","Bitcoin Withdrawal","BTC","-0.00150000","0","-0.00150000","BTC","","","COMPLETE","Bitcoin Credit","","Cash Balance"',
      // USD currency — dollars actually left to buy BTC. Net folds in the fee.
      '"2026-04-07 08:13:12 CDT","","Bitcoin Buy","USD","-$19.60","-$0.40","-$20.00","BTC","$69,075.33","0.00025000","COMPLETE","purchase of BTC","","Cash Balance"',
    );
    const { rows } = parseStatementCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amount).toBe(-20); // the USD buy, at its net
  });

  it('drops $0 rows (device logins, $0 loyalty)', () => {
    const csv = cashApp(
      '"2026-07-21 13:03:01 CDT","","Account Notifications","USD","$0.00","","$0.00","","","","COMPLETE","New device login","","Cash Balance"',
      '"2026-05-01 06:00:00 CDT","","Loyalty Rewards","USD","$0.00","$0.00","$0.00","","","","COMPLETE","$0 Payment From Someone","","Cash Balance"',
      '"2026-07-13 20:01:02 CDT","","","USD","-$50.00","$0.00","-$50.00","","","","COMPLETE","VENMO PAYMENT","","Cash Balance"',
    );
    const { rows } = parseStatementCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amount).toBe(-50);
  });

  it('strips $ and thousands separators from large amounts', () => {
    const csv = cashApp(
      '"2026-05-13 16:53:26 CDT","","","USD","-$1,500.00","$0.00","-$1,500.00","","","","COMPLETE","CREDIT CARD EPAY","","Cash Balance"',
    );
    expect(parseStatementCsv(csv).rows[0]!.amount).toBe(-1500);
  });

  it('takes the calendar day from the timestamp without converting the time', () => {
    const csv = cashApp(
      '"2026-07-21 23:50:00 CDT","","","USD","-$10.00","$0.00","-$10.00","","","","COMPLETE","LATE NIGHT","","Cash Balance"',
    );
    const { rows } = parseStatementCsv(csv);
    // The local day, not a UTC-shifted next day.
    expect(iso(rows[0]!.transactionDate)).toBe('2026-07-21');
    expect(iso(rows[0]!.postedDate)).toBe('2026-07-21');
  });

  it('falls back from Notes to the sender name to the type for a description', () => {
    const csv = cashApp(
      '"2025-03-19 16:50:44 CDT","#D-BBBB2222","P2P","USD","$140.00","$0.00","$140.00","","","","COMPLETE","","Alex Chen","Cash Balance"',
      '"2026-07-10 07:25:27 CDT","000000000","Withdrawal","USD","-$60.00","$0.00","-$60.00","","","","COMPLETE","","","Mastercard debit 0000"',
    );
    const { rows } = parseStatementCsv(csv);
    expect(rows[0]!.description).toBe('Alex Chen'); // Notes empty → name
    expect(rows[1]!.description).toBe('Withdrawal'); // Notes + name empty → type
  });

  it('derives the period from the surviving rows, not the filtered ones', () => {
    const csv = cashApp(
      '"2026-07-21 11:41:58 CDT","","P2P","USD","-$1,200.00","$0.00","-$1,200.00","","","","COMPLETE","x","","Cash Balance"',
      '"2026-08-01 00:00:00 CDT","","","USD","-$0.11","$0.00","-$0.11","","","","FAILED","later but failed","","Cash Balance"',
      '"2026-02-12 09:02:55 CST","","Deposits","USD","$2,000.00","$0.00","$2,000.00","","","","COMPLETE","Add Cash","","Cash Balance"',
    );
    const { periodStart, periodEnd } = parseStatementCsv(csv);
    expect(iso(periodStart)).toBe('2026-02-12');
    expect(iso(periodEnd)).toBe('2026-07-21'); // the FAILED 08-01 row does not extend it
  });

  it('drops the savings-interest sweep, which the cash balance never paid', () => {
    // Exported as a NEGATIVE on the cash balance, but the balance does not
    // move: the minus sign is how the export narrates interest paid straight
    // into the Savings pot. Keeping it drives the reconciled balance below the
    // statement by the interest every period.
    const csv = cashApp(
      '"2026-07-31 23:59:00 CDT","","Savings Interest Payment","USD","-$1.40","$0.00","-$1.40","","","","COMPLETE","","","Cash Balance"',
      '"2026-07-03 14:55:43 CDT","","","USD","-$450.00","$0.00","-$450.00","","","","COMPLETE","CORNER CAFE","","Cash Balance"',
    );
    const { rows } = parseStatementCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.description).toBe('CORNER CAFE');
  });

  it('keeps a real sub-dollar transaction', () => {
    // The rule keys off the transaction type, never the amount. A blanket
    // "skip small rows" would stop genuine small transactions reconciling.
    const csv = cashApp(
      '"2026-07-11 09:00:00 CDT","","","USD","-$0.99","$0.00","-$0.99","","","","COMPLETE","ITUNES","","Cash Balance"',
    );
    const { rows } = parseStatementCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amount).toBe(-0.99);
  });

  it('keeps an ordinary interest row that is not the savings sweep', () => {
    // Matched on the exact type, so anything else stays and asks its own
    // question rather than vanishing.
    const csv = cashApp(
      '"2026-07-31 23:59:00 CDT","","Interest Payment","USD","$2.10","$0.00","$2.10","","","","COMPLETE","","","Cash Balance"',
    );
    const { rows } = parseStatementCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amount).toBe(2.1);
  });

  /**
   * Rows copied verbatim from a real Cash Wallet export (2026-02).
   *
   * The invented row above proved the parser handles the shape a developer
   * believed Cash Wallet emits; it could not prove that is the shape it actually
   * emits. These are the real thing, kept because a purchase turns out to be
   * spelled at least three ways and only one of them was ever covered:
   *
   *   - `Bitcoin Buy`            — the one the older test used
   *   - `Bitcoin Recurring Buy`  — a DIFFERENT type, never tested
   *   - `` (empty)               — a purchase carrying no transaction type
   *
   * All three survive today only because the drop rules key off Currency and
   * Status rather than type. That is fine until a type-based rule arrives — as
   * the savings-interest sweep now is — at which point one written against
   * "Bitcoin Buy" would quietly take the recurring ones with it.
   */
  describe('real export rows', () => {
    it('keeps every spelling of a USD bitcoin purchase', () => {
      const csv = cashApp(
        '"2026-02-12 10:02:46 CST","","Bitcoin Buy","USD","-$2,000.00","$0.00","-$2,000.00","BTC","$67,563.97","0.03000000","COMPLETE","purchase of BTC 0.03000000","","Cash Balance"',
        '"2026-02-24 09:55:13 CST","","Bitcoin Recurring Buy","USD","-$50.00","$0.00","-$50.00","BTC","$63,858.62","0.00080000","COMPLETE","purchase of BTC 0.00080000","","Cash Balance"',
        '"2026-03-14 10:19:53 CDT","","","USD","-$0.65","$0.00","-$0.65","BTC","$70,720.00","0.00001000","COMPLETE","purchase of BTC 0.00001000","","Cash Balance"',
      );
      const { rows } = parseStatementCsv(csv);

      // Dollars genuinely left the cash balance for all three.
      expect(rows.map((r) => r.amount).sort((a, b) => a - b)).toEqual([-2000, -50, -0.65]);
    });

    it('still drops the BTC-denominated rows that surround them', () => {
      // Same file, same window: deposits and lightning payments move the
      // holding, not the cash balance, and a FAILED one moved nothing at all.
      const csv = cashApp(
        '"2026-02-14 20:25:34 CST","","Bitcoin Deposit","BTC","0.08","0","0.08","BTC","","","COMPLETE","Bitcoin Credit","","Cash Balance"',
        '"2026-02-16 08:06:49 CST","","Bitcoin Deposit","BTC","-0.020","0","-0.020","BTC","","","FAILED","Bitcoin Credit","","Cash Balance"',
        '"2026-02-14 07:41:25 CST","","","BTC","0.01000","0","0.01000","","","","COMPLETE","lnbc1p...csqek9jrw","","Cash Balance"',
        '"2026-02-14 09:04:46 CST","","Bitcoin Buy","USD","-$2,000.00","$0.00","-$2,000.00","BTC","$69,722.81","0.02800000","COMPLETE","purchase of BTC 0.02800000","","Cash Balance"',
      );
      const { rows } = parseStatementCsv(csv);

      expect(rows).toHaveLength(1);
      expect(rows[0]!.amount).toBe(-2000);
    });

    it('does not mistake a bitcoin purchase for the savings sweep', () => {
      // Both carry a transaction type and a negative net. Only one is
      // narration; the other is dollars that really left.
      const csv = cashApp(
        '"2026-07-01 10:51:16 CDT","","Savings Interest Payment","USD","-$1.40","$0.00","-$1.40","","","","COMPLETE","Savings","","Cash Balance"',
        '"2026-02-24 09:55:13 CST","","Bitcoin Recurring Buy","USD","-$50.00","$0.00","-$50.00","BTC","$63,858.62","0.00080000","COMPLETE","purchase of BTC 0.00080000","","Cash Balance"',
      );
      const { rows } = parseStatementCsv(csv);

      expect(rows).toHaveLength(1);
      expect(rows[0]!.amount).toBe(-50);
    });
  });

  it('refuses a Cash Wallet export with nothing reconcilable in it', () => {
    const csv = cashApp(
      '"2026-07-21 13:03:01 CDT","","Account Notifications","USD","$0.00","","$0.00","","","","COMPLETE","New device login","","Cash Balance"',
      '"2026-06-24 13:16:46 CDT","","Cash Card","USD","-$0.11","$0.00","-$0.11","","","","FAILED","RAZ*x","","Cash Balance"',
    );
    expect(() => parseStatementCsv(csv)).toThrow(StatementParseError);
  });
});

describe('parseStatementCsv — card format still works', () => {
  const CHASE = [
    'Transaction Date,Post Date,Description,Category,Type,Amount,Memo',
    '06/10/2026,06/11/2026,ACME BAKERY,Food,Sale,-24.50,',
    '06/12/2026,06/13/2026,"CORNER COFFEE, LLC",Food,Sale,-5.00,',
  ].join('\n');

  it('parses a Chase export, posted-date window and quoted commas intact', () => {
    const { rows, periodStart, periodEnd } = parseStatementCsv(CHASE);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ amount: -24.5, description: 'ACME BAKERY' });
    // Description with a comma survives the quoted-field split.
    expect(rows[1]!.description).toBe('CORNER COFFEE, LLC');
    // Window follows POSTED dates (06/11–06/13), not the transaction dates.
    expect(iso(periodStart)).toBe('2026-06-11');
    expect(iso(periodEnd)).toBe('2026-06-13');
  });
});
