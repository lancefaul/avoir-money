//! SPIKE arm B: the same balance chain and interactive transaction, in sea-orm.

mod entities;

use anyhow::Result;
use entities::{account, txn};
use sea_orm::sea_query::{Alias, Expr, ExprTrait, Query, SqliteQueryBuilder, UnionType};
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, ConnectionTrait, Database, DatabaseConnection,
    DatabaseTransaction, DbBackend, EntityTrait, FromQueryResult, QueryFilter, QueryOrder,
    Statement, TransactionTrait,
};

fn header(s: &str) {
    println!("\n\x1b[1m[sea-orm] {}\x1b[0m\n{}", s, "─".repeat(s.len() + 10));
}

#[derive(Debug)]
struct ChainEntry {
    id: String,
    is_inbound: bool,
    delta: i64,
    existing_before: Option<i64>,
}

#[tokio::main]
async fn main() -> Result<()> {
    let path = "/tmp/spike-seaorm.db";
    let _ = std::fs::remove_file(path);
    let db = Database::connect(format!("sqlite:{path}?mode=rwc")).await?;

    for stmt in include_str!("../../schema.sql").split(';') {
        if !stmt.trim().is_empty() {
            db.execute_unprepared(stmt).await?;
        }
    }

    seed(&db).await?;
    let n = chain_via_orm_api(&db, "acct-checking", 100_000).await?;
    println!("  rows rewritten: {n}");
    show_chain(&db).await?;
    chain_via_raw_union(&db, "acct-checking").await?;
    interactive_transaction_rollback(&db).await?;
    runtime_only_verification(&db).await?;

    Ok(())
}

async fn seed(db: &DatabaseConnection) -> Result<()> {
    header("seed");
    for (id, name, opening) in [("acct-checking", "Checking", 100_000i64), ("acct-savings", "Savings", 0)] {
        account::ActiveModel {
            id: Set(id.into()),
            name: Set(name.into()),
            opening_balance: Set(opening),
            balance: Set(opening),
        }
        .insert(db)
        .await?;
    }

    let rows: &[(&str, &str, Option<&str>, Option<&str>, &str, &str, i64)] = &[
        ("tx1", "acct-checking", None, None, "INCOME", "2026-01-05", 250_000),
        ("tx2", "acct-checking", None, None, "EXPENSE", "2026-01-06", 120_000),
        ("tx3", "acct-savings", Some("acct-checking"), None, "TRANSFER", "2026-01-07", 47_147),
        ("tx4", "acct-checking", None, None, "EXPENSE", "2026-01-08", 8_432),
        ("tx5", "acct-checking", None, Some("tx4"), "EXPENSE", "2026-01-08", 5_000),
    ];

    for (i, (id, acct, to_acct, parent, ty, date, net)) in rows.iter().enumerate() {
        txn::ActiveModel {
            id: Set((*id).into()),
            account_id: Set((*acct).into()),
            to_account_id: Set(to_acct.map(String::from)),
            parent_id: Set(parent.map(String::from)),
            r#type: Set((*ty).into()),
            trade_direction: Set(None),
            date: Set((*date).into()),
            created_at: Set(format!("2026-01-01T00:00:{:02}", i)),
            net_amount: Set(*net),
            balance_before: Set(None),
            balance_after: Set(None),
            to_balance_before: Set(None),
            to_balance_after: Set(None),
            quantity: Set(None),
        }
        .insert(db)
        .await?;
    }
    println!("  2 accounts, 5 transactions (1 inbound transfer, 1 child row)");
    Ok(())
}

fn delta_for(ty: &str, dir: Option<&str>, net: i64) -> i64 {
    match ty {
        "INCOME" | "REFUND" => net,
        "EXPENSE" | "TRANSFER" => -net,
        "TRADE" => match dir {
            Some("BUY") => -net,
            Some("SELL") => net,
            _ => 0,
        },
        _ => 0,
    }
}

/// The idiomatic sea-orm approach. Note what it forces: the ORM API has no
/// UNION, so this is two round trips plus an in-memory merge-sort — structurally
/// the same shape as the Prisma code it replaces, including the same hazard
/// (two lists that must be merged correctly, which is precisely where ADR-018's
/// bug lived for months).
async fn chain_via_orm_api(db: &DatabaseConnection, account_id: &str, start: i64) -> Result<usize> {
    header("recalculateChainForward — ORM API");

    let source = txn::Entity::find()
        .filter(txn::Column::AccountId.eq(account_id))
        .filter(txn::Column::ParentId.is_null())
        .order_by_asc(txn::Column::Date)
        .order_by_asc(txn::Column::CreatedAt)
        .order_by_asc(txn::Column::Id)
        .all(db)
        .await?;

    let inbound = txn::Entity::find()
        .filter(txn::Column::ToAccountId.eq(account_id))
        .filter(txn::Column::Type.eq("TRANSFER"))
        .filter(txn::Column::ParentId.is_null())
        .order_by_asc(txn::Column::Date)
        .order_by_asc(txn::Column::CreatedAt)
        .order_by_asc(txn::Column::Id)
        .all(db)
        .await?;

    println!("  two queries: {} source rows + {} inbound rows", source.len(), inbound.len());

    // The merge the ORM cannot do for us.
    let mut merged: Vec<(String, String, ChainEntry)> = Vec::new();
    for m in &source {
        merged.push((
            m.date.clone(),
            m.created_at.clone(),
            ChainEntry {
                id: m.id.clone(),
                is_inbound: false,
                delta: delta_for(&m.r#type, m.trade_direction.as_deref(), m.net_amount),
                existing_before: m.balance_before,
            },
        ));
    }
    for m in &inbound {
        merged.push((
            m.date.clone(),
            m.created_at.clone(),
            ChainEntry {
                id: m.id.clone(),
                is_inbound: true,
                delta: m.net_amount,
                existing_before: m.to_balance_before,
            },
        ));
    }
    merged.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)).then(a.2.id.cmp(&b.2.id)));
    println!("  merged in memory: {} rows", merged.len());

    let tx = db.begin().await?;
    let mut running = start;
    let mut written = 0;

    for (_, _, e) in &merged {
        if let Some(v) = e.existing_before {
            if v == running {
                break;
            }
        }
        let after = running + e.delta;
        let mut am: txn::ActiveModel = txn::Entity::find_by_id(e.id.clone())
            .one(&tx)
            .await?
            .unwrap()
            .into();
        if e.is_inbound {
            am.to_balance_before = Set(Some(running));
            am.to_balance_after = Set(Some(after));
        } else {
            am.balance_before = Set(Some(running));
            am.balance_after = Set(Some(after));
        }
        am.update(&tx).await?;
        running = after;
        written += 1;
    }

    let mut acct: account::ActiveModel = account::Entity::find_by_id(account_id.to_string())
        .one(&tx)
        .await?
        .unwrap()
        .into();
    acct.balance = Set(running);
    acct.update(&tx).await?;
    tx.commit().await?;

    Ok(written)
}

/// The alternative: express the UNION properly. sea-query can build it, but the
/// result is no longer a typed entity — it comes back through `FromQueryResult`,
/// so the column names are strings again and nothing verifies them until run time.
async fn chain_via_raw_union(db: &DatabaseConnection, account_id: &str) -> Result<()> {
    header("recalculateChainForward — sea-query UNION");

    let mut q = Query::select();
    q.expr_as(Expr::col(txn::Column::Id), Alias::new("id"))
        .expr_as(Expr::val(0), Alias::new("is_inbound"))
        .expr_as(Expr::col(txn::Column::NetAmount), Alias::new("delta"))
        .expr_as(Expr::col(txn::Column::BalanceBefore), Alias::new("existing_before"))
        .from(txn::Entity)
        .and_where(Expr::col(txn::Column::AccountId).eq(account_id))
        .and_where(Expr::col(txn::Column::ParentId).is_null());

    let mut inbound = Query::select();
    inbound
        .expr_as(Expr::col(txn::Column::Id), Alias::new("id"))
        .expr_as(Expr::val(1), Alias::new("is_inbound"))
        .expr_as(Expr::col(txn::Column::NetAmount), Alias::new("delta"))
        .expr_as(Expr::col(txn::Column::ToBalanceBefore), Alias::new("existing_before"))
        .from(txn::Entity)
        .and_where(Expr::col(txn::Column::ToAccountId).eq(account_id))
        .and_where(Expr::col(txn::Column::Type).eq("TRANSFER"))
        .and_where(Expr::col(txn::Column::ParentId).is_null());

    q.union(UnionType::All, inbound);
    let sql = q.to_string(SqliteQueryBuilder);
    println!("  built SQL: {}…", &sql[..std::cmp::min(90, sql.len())]);

    #[derive(Debug, FromQueryResult)]
    struct Row {
        id: String,
        is_inbound: i32,
        delta: i64,
    }

    let rows = Row::find_by_statement(Statement::from_string(DbBackend::Sqlite, sql))
        .all(db)
        .await?;
    println!("  returned {} rows, typed only by a struct nobody checked", rows.len());
    Ok(())
}

/// sea-orm's transaction handle is `DatabaseTransaction`, which implements
/// `ConnectionTrait` — so a hook can be generic over it. That is a genuinely
/// clean answer to the `Prisma.TransactionClient` threading requirement.
async fn interactive_transaction_rollback(db: &DatabaseConnection) -> Result<()> {
    header("interactive transaction — rollback path");

    let before = account::Entity::find_by_id("acct-checking".to_string())
        .one(db)
        .await?
        .unwrap()
        .balance;

    let tx = db.begin().await?;
    hook_insert(&tx, "tx-doomed-1", 5_000).await?;
    hook_bump(&tx, 5_000).await?;
    let failed = hook_insert(&tx, "tx-doomed-1", 1).await; // duplicate PK
    println!("  hook 3 failed as designed: {}", failed.is_err());
    tx.rollback().await?;

    let after = account::Entity::find_by_id("acct-checking".to_string())
        .one(db)
        .await?
        .unwrap()
        .balance;
    let leaked = txn::Entity::find()
        .filter(txn::Column::Id.starts_with("tx-doomed-"))
        .all(db)
        .await?
        .len();

    println!("  balance before {before} / after {after} → {}",
             if before == after { "\x1b[32munchanged\x1b[0m" } else { "\x1b[31mDRIFTED\x1b[0m" });
    println!("  doomed rows surviving: {leaked} → {}",
             if leaked == 0 { "\x1b[32mall-or-nothing holds\x1b[0m" } else { "\x1b[31mpartial write\x1b[0m" });
    Ok(())
}

/// A hook generic over any connection — pool or transaction. Same signature
/// shape as threading `Prisma.TransactionClient`.
async fn hook_insert<C: ConnectionTrait>(conn: &C, id: &str, net: i64) -> Result<()> {
    txn::ActiveModel {
        id: Set(id.into()),
        account_id: Set("acct-checking".into()),
        to_account_id: Set(None),
        parent_id: Set(None),
        r#type: Set("EXPENSE".into()),
        trade_direction: Set(None),
        date: Set("2026-02-01".into()),
        created_at: Set("2026-02-01T00:00:00".into()),
        net_amount: Set(net),
        balance_before: Set(None),
        balance_after: Set(None),
        to_balance_before: Set(None),
        to_balance_after: Set(None),
        quantity: Set(None),
    }
    .insert(conn)
    .await?;
    Ok(())
}

async fn hook_bump(tx: &DatabaseTransaction, delta: i64) -> Result<()> {
    let mut am: account::ActiveModel = account::Entity::find_by_id("acct-checking".to_string())
        .one(tx)
        .await?
        .unwrap()
        .into();
    let cur = am.balance.clone().unwrap();
    am.balance = Set(cur - delta);
    am.update(tx).await?;
    Ok(())
}

async fn show_chain(db: &DatabaseConnection) -> Result<()> {
    let rows = txn::Entity::find().order_by_asc(txn::Column::Date).all(db).await?;
    println!("  chain after:");
    for r in rows {
        let (b, a) = if r.to_balance_after.is_some() || r.to_balance_before.is_some() {
            (r.to_balance_before, r.to_balance_after)
        } else {
            (r.balance_before, r.balance_after)
        };
        let f = |v: Option<i64>| v.map(|c| format!("{:.2}", c as f64 / 100.0)).unwrap_or_else(|| "—".into());
        println!("    {:4} {:9} {} before {:>10} after {:>10}{}", r.id, r.r#type, r.date, f(b), f(a),
                 if r.parent_id.is_some() { "  (child — not in chain)" } else { "" });
    }
    Ok(())
}

/// The decisive difference. This entity claims a column that does not exist.
/// It compiles cleanly. The failure arrives at run time, from a query the
/// developer may not run until production.
async fn runtime_only_verification(db: &DatabaseConnection) -> Result<()> {
    header("verification: what a wrong column costs");

    mod bad {
        use sea_orm::entity::prelude::*;
        #[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
        #[sea_orm(table_name = "account")]
        pub struct Model {
            #[sea_orm(primary_key, auto_increment = false)]
            pub id: String,
            pub name: String,
            pub opening_balance: i64,
            /// Typo. There is no such column. This file compiles anyway.
            pub balnce: i64,
        }
        #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
        pub enum Relation {}
        impl ActiveModelBehavior for ActiveModel {}
    }

    println!("  entity declaring a non-existent column `balnce`: \x1b[32mCOMPILED\x1b[0m");
    match bad::Entity::find().all(db).await {
        Ok(_) => println!("  query: unexpectedly succeeded"),
        Err(e) => println!("  query at RUN time: \x1b[31m{}\x1b[0m", e),
    }
    Ok(())
}
