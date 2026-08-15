//! Hand-written sea-orm entities for the two tables the balance chain touches.
//!
//! Note what these are: Rust structs asserting what the database looks like.
//! Nothing checks that assertion at build time — that is the crux of the
//! comparison against sqlx's macros.

pub mod account {
    use sea_orm::entity::prelude::*;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
    #[sea_orm(table_name = "account")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = false)]
        pub id: String,
        pub name: String,
        pub opening_balance: i64,
        pub balance: i64,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}

pub mod txn {
    use sea_orm::entity::prelude::*;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
    #[sea_orm(table_name = "txn")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = false)]
        pub id: String,
        pub account_id: String,
        pub to_account_id: Option<String>,
        pub parent_id: Option<String>,
        pub r#type: String,
        pub trade_direction: Option<String>,
        pub date: String,
        pub created_at: String,
        pub net_amount: i64,
        pub balance_before: Option<i64>,
        pub balance_after: Option<i64>,
        pub to_balance_before: Option<i64>,
        pub to_balance_after: Option<i64>,
        pub quantity: Option<String>,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}
