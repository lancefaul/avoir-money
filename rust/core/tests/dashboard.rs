//! Pure dashboard logic: cash flow, spend prediction, and the period trend.

use avoir_core::cash_flow::{
    classify_expense, compute_cash_flow_summary, CashFlowItem, ExpenseKind,
};
use avoir_core::money::Cents;
use avoir_core::prediction::{
    compute_spend_prediction, prorate_budget, BudgetAllocation, BudgetPeriod, PeriodExpense,
    PredictionInput, SpendTx,
};
use avoir_core::trend::*;
use chrono::NaiveDate;

fn d(s: &str) -> NaiveDate {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
}

// ═══ Cash-flow classification ═══

#[test]
fn a_credit_card_expense_is_credit_and_everything_familiar_is_cash() {
    assert_eq!(classify_expense(Some("Credit Card")), ExpenseKind::Credit);
    for t in ["Checking", "Savings", "Cash", "Gift Card"] {
        assert_eq!(classify_expense(Some(t)), ExpenseKind::Cash, "{t}");
    }
}

#[test]
fn trapped_balances_fall_on_neither_card() {
    // An HSA can only pay medical bills and a Rewards account holds redeemable
    // rewards. Spending either draws down no spendable cash, so counting it as
    // cash spending would overstate what the user needs in the bank.
    assert_eq!(classify_expense(Some("HSA")), ExpenseKind::Excluded);
    assert_eq!(classify_expense(Some("Rewards")), ExpenseKind::Excluded);
}

#[test]
fn an_unknown_or_absent_account_type_counts_as_cash() {
    // The safe direction to be wrong in: an unrecognised type showing up as cash
    // overstates the cash need rather than hiding a bill.
    assert_eq!(classify_expense(None), ExpenseKind::Cash);
    assert_eq!(classify_expense(Some("Brokerage")), ExpenseKind::Cash);
}

#[test]
fn cash_needed_is_this_periods_cash_plus_last_periods_card_bill() {
    let items = [
        CashFlowItem {
            kind: ExpenseKind::Cash,
            amount: Cents(100_00),
        },
        CashFlowItem {
            kind: ExpenseKind::Credit,
            amount: Cents(50_00),
        },
        CashFlowItem {
            kind: ExpenseKind::Excluded,
            amount: Cents(999_00),
        },
    ];
    let s = compute_cash_flow_summary(&items, Cents(75_00), Cents(2_000_00), Cents(30_00));

    assert_eq!(s.cash_expenses, Cents(100_00));
    assert_eq!(s.credit_expenses, Cents(50_00));
    // The excluded item is in neither, and so cannot reach cash_needed either.
    assert_eq!(s.cash_needed, Cents(175_00));
    assert_eq!(s.previous_period_bank_balance, Cents(2_000_00));
    assert_eq!(s.credit_card_payments, Cents(30_00));
}

#[test]
fn this_periods_credit_spending_is_not_part_of_this_periods_cash_need() {
    // It is charged now and paid next period — that is the entire point of the
    // split, and folding it in would double-count when it arrives as the
    // previous-period total next time.
    let items = [CashFlowItem {
        kind: ExpenseKind::Credit,
        amount: Cents(500_00),
    }];
    let s = compute_cash_flow_summary(&items, Cents(0), Cents(0), Cents(0));
    assert_eq!(s.cash_needed, Cents(0));
    assert_eq!(s.credit_expenses, Cents(500_00));
}

// ═══ Budget proration ═══

#[test]
fn a_monthly_budget_is_spread_over_the_pay_periods_of_a_year() {
    // $260/month × 12 ÷ 26 biweekly periods = $120 each.
    let got = prorate_budget(
        Cents(260_00),
        BudgetPeriod::Monthly,
        None,
        "BIWEEKLY",
        d("2026-03-01"),
        d("2026-03-14"),
    );
    assert_eq!(got, Cents(120_00));
}

#[test]
fn a_yearly_budget_divides_by_the_period_count_directly() {
    let got = prorate_budget(
        Cents(1_300_00),
        BudgetPeriod::Yearly,
        None,
        "BIWEEKLY",
        d("2026-03-01"),
        d("2026-03-14"),
    );
    assert_eq!(got, Cents(50_00));
}

#[test]
fn proration_rounds_to_the_cent_rather_than_truncating() {
    // $100/month × 12 ÷ 26 = $46.1538…, which must land on 46.15 rather than
    // being cut to 46.15 by luck or to 46.00 by integer division of dollars.
    let got = prorate_budget(
        Cents(100_00),
        BudgetPeriod::Monthly,
        None,
        "BIWEEKLY",
        d("2026-03-01"),
        d("2026-03-14"),
    );
    assert_eq!(got, Cents(46_15));

    // And a case that rounds UP, which truncation would get wrong.
    // $50/month × 12 ÷ 52 = $11.538… → 11.54.
    let weekly = prorate_budget(
        Cents(50_00),
        BudgetPeriod::Monthly,
        None,
        "WEEKLY",
        d("2026-03-01"),
        d("2026-03-07"),
    );
    assert_eq!(weekly, Cents(11_54));
}

#[test]
fn a_seasonal_budget_contributes_nothing_outside_its_months() {
    // A heating budget belongs to January, not to July.
    let winter = Some(vec![1u32, 2, 12]);
    let july = prorate_budget(
        Cents(300_00),
        BudgetPeriod::Monthly,
        winter.as_deref(),
        "MONTHLY",
        d("2026-07-01"),
        d("2026-07-31"),
    );
    assert_eq!(july, Cents(0));

    let january = prorate_budget(
        Cents(300_00),
        BudgetPeriod::Monthly,
        winter.as_deref(),
        "MONTHLY",
        d("2026-01-01"),
        d("2026-01-31"),
    );
    assert_eq!(january, Cents(300_00));
}

#[test]
fn a_seasonal_budget_is_found_across_a_year_boundary() {
    // Dec 20 – Jan 3 wraps, so the month range test has to invert. Without that
    // the busiest fortnight of a winter budget silently contributes zero.
    let winter = Some(vec![1u32, 12]);
    let got = prorate_budget(
        Cents(260_00),
        BudgetPeriod::Monthly,
        winter.as_deref(),
        "BIWEEKLY",
        d("2025-12-20"),
        d("2026-01-03"),
    );
    assert_eq!(got, Cents(120_00));
}

#[test]
fn an_unrecognised_schedule_type_prorates_to_nothing() {
    let got = prorate_budget(
        Cents(260_00),
        BudgetPeriod::Monthly,
        None,
        "FORTNIGHTLY-ISH",
        d("2026-03-01"),
        d("2026-03-14"),
    );
    assert_eq!(got, Cents(0));
}

// ═══ Spend prediction ═══

fn alloc(id: &str, amount: i64, linked: bool) -> BudgetAllocation {
    BudgetAllocation {
        budget_id: id.into(),
        amount: Cents(amount),
        period: BudgetPeriod::Monthly,
        active_months: None,
        has_linked_expenses: linked,
    }
}

#[test]
fn a_linked_budget_contributes_only_what_the_bills_leave_behind() {
    // $260/month → $120 per biweekly period, with $80 of it already committed to
    // a recurring bill. $40 is discretionary.
    let allocations = [alloc("food", 260_00, true)];
    let expenses = [PeriodExpense {
        budget_id: "food".into(),
        amount: Cents(80_00),
    }];
    let p = compute_spend_prediction(PredictionInput {
        period_start: d("2026-03-01"),
        period_end: d("2026-03-14"),
        today: d("2026-03-01"),
        schedule_type: "BIWEEKLY",
        period_expenses: &expenses,
        budget_allocations: &allocations,
        transactions: &[],
    });
    assert_eq!(p.expected_period_spend, Cents(40_00));
}

#[test]
fn a_budget_overrun_by_its_own_bills_lends_no_negative_room_to_the_others() {
    // $120 prorated against $200 of bills is −$80, floored at zero. Without the
    // floor it would silently reduce every other budget's discretionary space.
    let allocations = [alloc("food", 260_00, true), alloc("fun", 260_00, false)];
    let expenses = [PeriodExpense {
        budget_id: "food".into(),
        amount: Cents(200_00),
    }];
    let p = compute_spend_prediction(PredictionInput {
        period_start: d("2026-03-01"),
        period_end: d("2026-03-14"),
        today: d("2026-03-01"),
        schedule_type: "BIWEEKLY",
        period_expenses: &expenses,
        budget_allocations: &allocations,
        transactions: &[],
    });
    assert_eq!(p.expected_period_spend, Cents(120_00), "only 'fun' counts");
}

#[test]
fn a_negative_allocation_cannot_eat_into_another_budgets_room() {
    // The `> 0` guard on the unlinked branch is the only thing stopping a
    // negative allocation — a typo, or a correction entered the wrong way round
    // — from silently reducing every other budget's discretionary space.
    let allocations = [alloc("fun", 260_00, false), alloc("oops", -130_00, false)];
    let p = compute_spend_prediction(PredictionInput {
        period_start: d("2026-03-01"),
        period_end: d("2026-03-14"),
        today: d("2026-03-01"),
        schedule_type: "BIWEEKLY",
        period_expenses: &[],
        budget_allocations: &allocations,
        transactions: &[],
    });
    assert_eq!(p.expected_period_spend, Cents(120_00), "'fun' is untouched");
}

#[test]
fn an_unlinked_budget_is_discretionary_in_full() {
    let allocations = [alloc("fun", 260_00, false)];
    let p = compute_spend_prediction(PredictionInput {
        period_start: d("2026-03-01"),
        period_end: d("2026-03-14"),
        today: d("2026-03-01"),
        schedule_type: "BIWEEKLY",
        period_expenses: &[],
        budget_allocations: &allocations,
        transactions: &[],
    });
    assert_eq!(p.expected_period_spend, Cents(120_00));
}

#[test]
fn a_bill_with_no_budget_allocation_leaves_nothing_to_spend() {
    // Fully mandatory, so there is no discretionary remainder — not the bill's
    // own amount, which would invite spending money already committed.
    let expenses = [PeriodExpense {
        budget_id: "rent".into(),
        amount: Cents(1_200_00),
    }];
    let p = compute_spend_prediction(PredictionInput {
        period_start: d("2026-03-01"),
        period_end: d("2026-03-14"),
        today: d("2026-03-01"),
        schedule_type: "BIWEEKLY",
        period_expenses: &expenses,
        budget_allocations: &[],
        transactions: &[],
    });
    assert_eq!(p.expected_period_spend, Cents(0));
}

#[test]
fn the_expected_line_lands_exactly_on_the_period_total() {
    // Computed from the total each day rather than by accumulating a rounded
    // daily rate. $100 over 14 days is $7.142…/day — accumulating that would
    // miss the total by up to 14 half-cents on the very point the chart exists
    // to make.
    let allocations = [alloc("fun", 216_67, false)];
    let p = compute_spend_prediction(PredictionInput {
        period_start: d("2026-03-01"),
        period_end: d("2026-03-14"),
        today: d("2026-03-01"),
        schedule_type: "BIWEEKLY",
        period_expenses: &[],
        budget_allocations: &allocations,
        transactions: &[],
    });
    assert_eq!(p.total_days, 14);
    let last = p.daily_data.last().unwrap();
    assert_eq!(last.day_number, 14);
    assert_eq!(
        last.expected_cumulative, p.expected_period_spend,
        "the final expected point IS the period total"
    );
}

#[test]
fn the_expected_line_never_goes_backwards() {
    let allocations = [alloc("fun", 137_03, false)];
    let p = compute_spend_prediction(PredictionInput {
        period_start: d("2026-03-01"),
        period_end: d("2026-03-14"),
        today: d("2026-03-14"),
        schedule_type: "BIWEEKLY",
        period_expenses: &[],
        budget_allocations: &allocations,
        transactions: &[],
    });
    for w in p.daily_data.windows(2) {
        assert!(
            w[1].expected_cumulative.0 >= w[0].expected_cumulative.0,
            "day {} went backwards",
            w[1].day_number
        );
    }
}

#[test]
fn the_actual_line_stops_at_today_rather_than_flatlining_into_the_future() {
    let txs = [
        SpendTx {
            date: d("2026-03-01"),
            amount: Cents(10_00),
        },
        SpendTx {
            date: d("2026-03-03"),
            amount: Cents(15_00),
        },
    ];
    let p = compute_spend_prediction(PredictionInput {
        period_start: d("2026-03-01"),
        period_end: d("2026-03-14"),
        today: d("2026-03-05"),
        schedule_type: "BIWEEKLY",
        period_expenses: &[],
        budget_allocations: &[alloc("fun", 260_00, false)],
        transactions: &txs,
    });

    assert_eq!(p.current_day_number, 5);
    assert_eq!(p.daily_data[0].actual_cumulative, Some(Cents(10_00)));
    assert_eq!(p.daily_data[2].actual_cumulative, Some(Cents(25_00)));
    assert_eq!(p.daily_data[4].actual_cumulative, Some(Cents(25_00)));
    assert!(
        p.daily_data[5..]
            .iter()
            .all(|x| x.actual_cumulative.is_none()),
        "no actual line past today"
    );
}

#[test]
fn spending_outside_the_period_is_ignored_rather_than_bucketed_at_the_edges() {
    let txs = [
        SpendTx {
            date: d("2026-02-25"),
            amount: Cents(500_00),
        },
        SpendTx {
            date: d("2026-03-20"),
            amount: Cents(500_00),
        },
    ];
    let p = compute_spend_prediction(PredictionInput {
        period_start: d("2026-03-01"),
        period_end: d("2026-03-14"),
        today: d("2026-03-14"),
        schedule_type: "BIWEEKLY",
        period_expenses: &[],
        budget_allocations: &[alloc("fun", 260_00, false)],
        transactions: &txs,
    });
    assert_eq!(
        p.daily_data.last().unwrap().actual_cumulative,
        Some(Cents(0))
    );
}

#[test]
fn over_under_compares_today_against_todays_expected_point() {
    // $120 over 14 days; by day 7 the expected line is at $60. Spending $100
    // puts the user $40 over.
    let txs = [SpendTx {
        date: d("2026-03-01"),
        amount: Cents(100_00),
    }];
    let p = compute_spend_prediction(PredictionInput {
        period_start: d("2026-03-01"),
        period_end: d("2026-03-14"),
        today: d("2026-03-07"),
        schedule_type: "BIWEEKLY",
        period_expenses: &[],
        budget_allocations: &[alloc("fun", 260_00, false)],
        transactions: &txs,
    });
    assert_eq!(p.daily_data[6].expected_cumulative, Cents(60_00));
    assert_eq!(p.over_under_amount, Cents(40_00));
}

#[test]
fn a_day_past_the_period_end_clamps_to_the_last_day() {
    // Viewing a period after it closed must not index past the chart.
    let p = compute_spend_prediction(PredictionInput {
        period_start: d("2026-03-01"),
        period_end: d("2026-03-14"),
        today: d("2026-04-30"),
        schedule_type: "BIWEEKLY",
        period_expenses: &[],
        budget_allocations: &[alloc("fun", 260_00, false)],
        transactions: &[],
    });
    assert_eq!(p.current_day_number, 14);
    assert!(p.daily_data.iter().all(|x| x.actual_cumulative.is_some()));
}

// ═══ Trend ═══

#[test]
fn periods_are_classified_against_today_inclusively() {
    let today = d("2026-03-10");
    assert_eq!(
        classify_period(d("2026-02-01"), d("2026-02-28"), today),
        PeriodKind::Past
    );
    assert_eq!(
        classify_period(d("2026-03-01"), d("2026-03-14"), today),
        PeriodKind::Current
    );
    assert_eq!(
        classify_period(d("2026-04-01"), d("2026-04-14"), today),
        PeriodKind::Future
    );
    // The boundaries belong to the current period, not to its neighbours.
    assert_eq!(
        classify_period(today, d("2026-03-20"), today),
        PeriodKind::Current
    );
    assert_eq!(
        classify_period(d("2026-03-01"), today, today),
        PeriodKind::Current
    );
}

#[test]
fn only_past_periods_are_reported_as_settled() {
    assert!(!PeriodKind::Past.projected());
    assert!(PeriodKind::Current.projected());
    assert!(PeriodKind::Future.projected());
}

#[test]
fn a_refund_reduces_spending_rather_than_adding_to_it() {
    let txs = [
        TrendTx {
            amount: Cents(100_00),
            net_amount: Cents(100_00),
            tx_type: "EXPENSE",
            date: d("2026-03-02"),
        },
        TrendTx {
            amount: Cents(30_00),
            net_amount: Cents(30_00),
            tx_type: "REFUND",
            date: d("2026-03-03"),
        },
    ];
    let t = compute_past_period_totals(&txs, d("2026-03-01"), d("2026-03-14"));
    assert_eq!(t.expenses, Cents(70_00));
}

#[test]
fn income_counts_gross_while_spending_counts_what_was_charged() {
    let txs = [
        TrendTx {
            amount: Cents(2_000_00),
            net_amount: Cents(1_900_00),
            tx_type: "INCOME",
            date: d("2026-03-02"),
        },
        TrendTx {
            amount: Cents(175_61),
            net_amount: Cents(124_04),
            tx_type: "EXPENSE",
            date: d("2026-03-02"),
        },
    ];
    let t = compute_past_period_totals(&txs, d("2026-03-01"), d("2026-03-14"));
    assert_eq!(t.income, Cents(2_000_00));
    assert_eq!(t.expenses, Cents(124_04), "what the account was billed");
}

#[test]
fn the_current_period_adds_only_what_is_still_pending() {
    // A PAID occurrence already has a real transaction counted, so adding its
    // expected amount too would double every bill the moment it is paid.
    let txs = [TrendTx {
        amount: Cents(80_00),
        net_amount: Cents(80_00),
        tx_type: "EXPENSE",
        date: d("2026-03-02"),
    }];
    let sched = [
        TrendScheduled {
            expected_amount: Cents(80_00),
            source_type: "EXPENSE",
            status: "PAID",
            due_date: d("2026-03-02"),
        },
        TrendScheduled {
            expected_amount: Cents(50_00),
            source_type: "EXPENSE",
            status: "PENDING",
            due_date: d("2026-03-10"),
        },
        TrendScheduled {
            expected_amount: Cents(99_00),
            source_type: "EXPENSE",
            status: "SKIPPED",
            due_date: d("2026-03-11"),
        },
    ];
    let t = compute_current_period_totals(&txs, &sched, d("2026-03-01"), d("2026-03-14"));
    assert_eq!(t.expenses, Cents(130_00), "80 actual + 50 pending");
}

#[test]
fn a_future_period_projects_no_trades() {
    // A future trade is a decision nobody has made yet.
    let sched = [TrendScheduled {
        expected_amount: Cents(2_000_00),
        source_type: "INCOME",
        status: "PENDING",
        due_date: d("2026-04-03"),
    }];
    let t = compute_future_period_totals(&sched, d("2026-04-01"), d("2026-04-14"));
    assert_eq!(t.income, Cents(2_000_00));
    assert_eq!(t.trades, Cents(0));
}

#[test]
fn a_budgets_monthly_figure_becomes_its_per_period_share() {
    assert_eq!(prorate_budget_to_period(Cents(260_00), 26), Cents(120_00));
    assert_eq!(prorate_budget_to_period(Cents(100_00), 26), Cents(46_15));
    assert_eq!(prorate_budget_to_period(Cents(100_00), 0), Cents(0));
}

#[test]
fn periods_per_year_falls_back_to_biweekly_for_anything_unrecognised() {
    assert_eq!(periods_per_year("WEEKLY"), 52);
    assert_eq!(periods_per_year("BIWEEKLY"), 26);
    assert_eq!(periods_per_year("SEMI_MONTHLY"), 24);
    assert_eq!(periods_per_year("MONTHLY"), 12);
    assert_eq!(periods_per_year("???"), 26);
}

#[test]
fn a_budget_with_no_stated_months_is_active_all_year() {
    assert!(is_seasonal_budget_active_for_period(
        &[],
        d("2026-07-01"),
        d("2026-07-14")
    ));
}

#[test]
fn seasonal_months_here_are_zero_indexed() {
    // The caller subtracts one from the stored 1-indexed months, so 0 is
    // January. Getting this backwards shifts every season by a month, which
    // looks plausible on screen and is wrong all year.
    let january_only = [0u32];
    assert!(is_seasonal_budget_active_for_period(
        &january_only,
        d("2026-01-05"),
        d("2026-01-18")
    ));
    assert!(!is_seasonal_budget_active_for_period(
        &january_only,
        d("2026-02-05"),
        d("2026-02-18")
    ));
}

#[test]
fn a_period_straddling_two_months_is_active_if_either_month_is() {
    let february_only = [1u32];
    assert!(is_seasonal_budget_active_for_period(
        &february_only,
        d("2026-01-25"),
        d("2026-02-07")
    ));
}

// ═══ Display status ═══

#[test]
fn a_pending_occurrence_reads_from_the_calendar() {
    let today = d("2026-03-10");
    assert_eq!(
        map_schedule_status("PENDING", d("2026-03-05"), None, today),
        "OVERDUE"
    );
    assert_eq!(map_schedule_status("PENDING", today, None, today), "DUE");
    assert_eq!(
        map_schedule_status("PENDING", d("2026-03-20"), None, today),
        "UPCOMING"
    );
}

#[test]
fn a_settled_occurrence_keeps_its_own_status_whatever_the_date() {
    let today = d("2026-03-10");
    for s in ["PAID", "PARTIAL", "SKIPPED"] {
        assert_eq!(map_schedule_status(s, d("2026-01-01"), None, today), s);
    }
}

#[test]
fn an_expired_snooze_resurfaces_as_overdue() {
    // Otherwise a bill snoozed once stays quietly hidden forever, which is the
    // opposite of what snoozing means.
    let today = d("2026-03-10");
    assert_eq!(
        map_schedule_status("SNOOZED", d("2026-03-05"), Some(d("2026-03-08")), today),
        "OVERDUE"
    );
    assert_eq!(
        map_schedule_status("SNOOZED", d("2026-03-05"), Some(d("2026-03-20")), today),
        "SNOOZED"
    );
    // A snooze through today has expired by the time today arrives.
    assert_eq!(
        map_schedule_status("SNOOZED", d("2026-03-05"), Some(today), today),
        "OVERDUE"
    );
}

#[test]
fn a_pause_through_today_has_already_expired() {
    let today = d("2026-03-10");
    assert!(!is_paused(None, today));
    assert!(!is_paused(Some(d("2026-03-09")), today));
    assert!(!is_paused(Some(today), today), "resumes today");
    assert!(is_paused(Some(d("2026-03-11")), today));
}
