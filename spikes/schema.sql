-- Shared spike schema. A faithful reduction of the real Account/Transaction
-- pair: enough to exercise the balance chain, not the whole 39-model schema.
--
-- Money is INTEGER cents (the decimal spike's finding).
-- Quantity/unit-price are TEXT decimals — they are not money and cannot be cents.

CREATE TABLE account (
    id              TEXT    PRIMARY KEY,
    name            TEXT    NOT NULL,
    opening_balance INTEGER NOT NULL DEFAULT 0,
    balance         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE txn (
    id                TEXT    PRIMARY KEY,
    account_id        TEXT    NOT NULL REFERENCES account(id) ON DELETE RESTRICT,
    to_account_id     TEXT             REFERENCES account(id) ON DELETE RESTRICT,
    parent_id         TEXT             REFERENCES txn(id)     ON DELETE CASCADE,
    type              TEXT    NOT NULL,
    trade_direction   TEXT,
    date              TEXT    NOT NULL,
    created_at        TEXT    NOT NULL,
    net_amount        INTEGER NOT NULL,
    balance_before    INTEGER,
    balance_after     INTEGER,
    to_balance_before INTEGER,
    to_balance_after  INTEGER,
    quantity          TEXT
);

-- The chain walk orders by (date, created_at, id) and filters parent_id IS NULL.
CREATE INDEX idx_txn_chain     ON txn (account_id, parent_id, date, created_at, id);
CREATE INDEX idx_txn_chain_in  ON txn (to_account_id, type, parent_id, date, created_at, id);
