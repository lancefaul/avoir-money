-- Generates the numeric-column classification manifest from the LIVE catalog.
--
-- The classification below is a judgement about what each column *means*; the
-- scale and row-count columns are measured. Joining against
-- information_schema means a column that exists in the database but is missing
-- from the list below comes out with class = null rather than silently being
-- dropped — see the assertion at the bottom.
--
-- class semantics:
--   money      → INTEGER cents (scale 2) on SQLite. ADR-033.
--   percentage → a rate expressed in percent (0-100), never aggregated.
--   quantity   → units held or consumed (shares, sats, kWh). Never cents.
--   unit_price → money per unit. Never cents.

WITH classification(tbl, col, class) AS (
    VALUES
    ('Account','balance','money'),
    ('Account','interestRate','percentage'),
    ('Account','openingBalance','money'),
    ('BalanceSnapshot','closingBalance','money'),
    ('BalanceSnapshot','openingBalance','money'),
    ('BalanceSnapshot','totalExpenses','money'),
    ('BalanceSnapshot','totalIncome','money'),
    ('BitcoinPaymentDetail','quantity','quantity'),
    ('BitcoinPaymentDetail','unitPrice','unit_price'),
    ('BudgetGoal','currentAmount','money'),
    ('BudgetGoal','targetAmount','money'),
    ('BudgetVersion','amount','money'),
    ('BudgetVersion','monthlyEquivalent','money'),
    ('CategoryBudget','highWaterMark','money'),
    ('Debt','apr','percentage'),
    ('Debt','currentBalance','money'),
    ('Debt','minimumPayment','money'),
    ('Debt','originalBalance','money'),
    ('DebtPayment','interestAmount','money'),
    ('DebtPayment','principalAmount','money'),
    ('EscrowRecord','monthlyAmount','money'),
    ('Expense','amount','money'),
    ('HealthcareYear','dentalPremium','money'),
    ('HealthcareYear','medicalDeductible','money'),
    ('HealthcareYear','medicalOOPM','money'),
    ('HealthcareYear','medicalPremium','money'),
    ('HealthcareYear','paidOutOfPocket','money'),
    ('HealthcareYear','visionPremium','money'),
    ('Income','amount','money'),
    ('InsurancePolicy','deductibleLimit','money'),
    ('InsurancePolicy','oopmLimit','money'),
    ('InsurancePolicy','premium','money'),
    ('InvestmentHolding','costBasis','money'),
    ('InvestmentHolding','quantity','quantity'),
    ('InvestmentSnapshot','quantity','quantity'),
    ('InvestmentSnapshot','value','money'),
    ('InvestmentTransfer','bitcoinPrice','unit_price'),
    -- NOT money: this is an amount in `feeUnit`, which may be Bitcoin, Sats or
    -- USD. Cents would round a 5,000-sat fee to zero. See migration
    -- 0003_transfer_fee_amount_is_not_money.sql.
    ('InvestmentTransfer','feeAmount','quantity'),
    ('InvestmentTransfer','feeBtc','quantity'),
    ('InvestmentTransfer','quantity','quantity'),
    ('ReconciliationSession','residualAtClose','money'),
    ('ReconciliationSession','statementEndingBalance','money'),
    ('ScheduledTransaction','actualAmount','money'),
    ('ScheduledTransaction','expectedAmount','money'),
    ('StatementRow','amount','money'),
    ('TradeDetail','quantity','quantity'),
    ('TradeDetail','unitPrice','unit_price'),
    ('Transaction','amount','money'),
    ('Transaction','balanceAfter','money'),
    ('Transaction','balanceBefore','money'),
    ('Transaction','costBasisAllocated','money'),
    ('Transaction','netAmount','money'),
    ('Transaction','preTaxAmount','money'),
    ('Transaction','taxAmount','money'),
    ('Transaction','taxRate','percentage'),
    ('Transaction','toBalanceAfter','money'),
    ('Transaction','toBalanceBefore','money'),
    ('UtilityReading','convenienceFee','money'),
    ('UtilityReading','cost','money'),
    ('UtilityReading','otherFees','money'),
    ('UtilityReading','unitCost','unit_price'),
    ('UtilityReading','usage','quantity')
),
live AS (
    SELECT table_name AS tbl, column_name AS col,
           numeric_precision AS prec, numeric_scale AS declared_scale
    FROM information_schema.columns
    WHERE table_schema = 'public' AND data_type = 'numeric'
)
SELECT json_agg(
    json_build_object(
        'table', l.tbl,
        'column', l.col,
        'class', c.class,
        'declared', 'DECIMAL(' || l.prec || ',' || l.declared_scale || ')',
        'storage', CASE c.class
                       WHEN 'money' THEN 'integer_cents'
                       ELSE 'decimal_text'
                   END
    ) ORDER BY l.tbl, l.col
)
FROM live l
LEFT JOIN classification c ON c.tbl = l.tbl AND c.col = l.col;
