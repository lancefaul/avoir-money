//! Budget status and seasonal activity.

use avoir_core::budget::{compute_budget_status, is_seasonal_active_in_month};
use avoir_core::money::Cents;

// ═══ Budget status ═══

#[test]
fn an_allocation_of_zero_has_no_status() {
    // Not "under". A category with nothing allocated cannot be under or over
    // it, and reporting `under` would paint every unallocated budget green.
    assert_eq!(compute_budget_status(Cents(50_00), Cents(0)), None);
    assert_eq!(compute_budget_status(Cents(0), Cents(0)), None);
}

#[test]
fn the_eighty_percent_boundary_falls_on_near_not_under() {
    // Exactly 80% is the first point that is NOT comfortably under, so it is
    // the warning band. Computed as `actual * 10 < allocation * 8` rather than
    // against 0.8 — a float comparison puts this case on whichever side
    // rounding chose that day.
    assert_eq!(
        compute_budget_status(Cents(79_99), Cents(100_00)),
        Some("under")
    );
    assert_eq!(
        compute_budget_status(Cents(80_00), Cents(100_00)),
        Some("near")
    );
}

#[test]
fn spending_the_allocation_exactly_is_near_and_a_penny_more_is_over() {
    assert_eq!(
        compute_budget_status(Cents(100_00), Cents(100_00)),
        Some("near")
    );
    assert_eq!(
        compute_budget_status(Cents(100_01), Cents(100_00)),
        Some("over")
    );
}

#[test]
fn a_refunded_category_can_go_negative_and_reads_as_under() {
    // Net spending is expenses minus refunds, so a month with more returns than
    // purchases is genuinely below its budget.
    assert_eq!(
        compute_budget_status(Cents(-25_00), Cents(100_00)),
        Some("under")
    );
}

#[test]
fn a_budget_with_no_stated_months_is_active_every_month() {
    for m in 1..=12 {
        assert!(is_seasonal_active_in_month(&[], m), "month {m}");
    }
}

#[test]
fn seasonal_months_here_are_one_indexed() {
    // Stored 1-indexed, consumed 1-indexed. The trend module's equivalent is
    // 0-indexed because its caller subtracts one — getting the two confused
    // shifts every season by a month and looks plausible all year.
    let winter = [1u32, 2, 12];
    assert!(is_seasonal_active_in_month(&winter, 1), "January");
    assert!(is_seasonal_active_in_month(&winter, 12), "December");
    assert!(!is_seasonal_active_in_month(&winter, 7), "July");
}
