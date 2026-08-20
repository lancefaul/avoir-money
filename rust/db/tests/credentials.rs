//! The guard behind ADR-035.
//!
//! Credentials are stored unencrypted, and the reason that is acceptable is that
//! neither route out of this machine carries them: backups clear the tables and
//! vacuum the freed pages, and the JSON export writes them out empty. Both read
//! `avoir_db::CREDENTIAL_TABLES`.
//!
//! So the whole decision rests on that list being complete. A table added later
//! with a token or a password column, and not added here, silently reverts
//! ADR-035 for that credential — with nothing failing and nothing to notice.
//! This is the test that notices.

use avoir_db::CREDENTIAL_TABLES;

/// Column names that mean "this holds something nobody else should have".
///
/// Matched case-insensitively as substrings, so `secretCipher`, `apiKey`,
/// `refreshToken` and `passwordHash` all trip it. Deliberately broad: a false
/// positive costs one line in `CREDENTIAL_TABLES` or one word here, and a false
/// negative costs a leaked key.
const CREDENTIAL_WORDS: [&str; 6] = [
    "secret",
    "token",
    "password",
    "apikey",
    "credential",
    "passphrase",
];

fn looks_like_a_credential(column: &str) -> bool {
    let lower = column.to_lowercase();
    CREDENTIAL_WORDS.iter().any(|w| lower.contains(w))
}

#[tokio::test]
async fn credential_tables_cover_the_schema() {
    // Built by running the migrations, not by parsing them. That way a table
    // created under one name and renamed into place — which 0003 and 0004 both
    // do — is inspected as it finally exists, and the check cannot be fooled by
    // SQL it does not know how to read.
    let pool = avoir_db::connect_in_memory().await.expect("schema");

    let tables: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert!(
        tables.len() > 30,
        "expected the full schema, got {}",
        tables.len()
    );

    let mut unlisted: Vec<String> = Vec::new();
    for table in &tables {
        // `pragma_table_info` takes the table as a bound argument, so nothing
        // here interpolates a name into SQL.
        let columns: Vec<String> = sqlx::query_scalar("SELECT name FROM pragma_table_info(?)")
            .bind(table)
            .fetch_all(&pool)
            .await
            .unwrap();
        for column in columns.iter().filter(|c| looks_like_a_credential(c)) {
            if !CREDENTIAL_TABLES.contains(&table.as_str()) {
                unlisted.push(format!("{table}.{column}"));
            }
        }
    }

    assert!(
        unlisted.is_empty(),
        "these columns hold credentials but their table is not in \
         avoir_db::CREDENTIAL_TABLES, so backups and the JSON export will carry \
         them off this machine in plain text (ADR-035): {unlisted:?}"
    );
}

#[tokio::test]
async fn every_listed_table_actually_exists() {
    // A stale name in the list is not harmless: `strip_credentials` runs a
    // DELETE per entry, so a table that has been renamed away turns every
    // backup into an error — and the list would still *look* like it was doing
    // its job.
    let pool = avoir_db::connect_in_memory().await.expect("schema");
    for table in CREDENTIAL_TABLES {
        let found: Option<String> =
            sqlx::query_scalar("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
                .bind(table)
                .fetch_optional(&pool)
                .await
                .unwrap();
        assert!(
            found.is_some(),
            "CREDENTIAL_TABLES names {table}, which does not exist"
        );
    }
}

#[test]
fn the_words_catch_the_shapes_a_future_credential_would_take() {
    for name in [
        "secret",
        "secretCipher",
        "apiKey",
        "refreshToken",
        "accessToken",
        "passwordHash",
        "clientSecret",
        "credentialBlob",
        "passphrase",
    ] {
        assert!(looks_like_a_credential(name), "{name} should have matched");
    }
    // Not everything with a scary-adjacent name is one.
    for name in ["id", "name", "balance", "tokenizedAt_", "description"] {
        assert_eq!(
            looks_like_a_credential(name),
            name.to_lowercase().contains("token"),
            "{name}"
        );
    }
}
