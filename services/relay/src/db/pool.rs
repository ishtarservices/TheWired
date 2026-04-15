use sqlx::PgPool;

pub async fn create_pool(database_url: &str) -> anyhow::Result<PgPool> {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(20)
        .min_connections(2)
        .acquire_timeout(std::time::Duration::from_secs(5))
        .connect(database_url)
        .await?;

    tracing::info!("Connected to database (pool: 2-20 connections)");
    Ok(pool)
}

pub async fn run_migrations(pool: &PgPool) -> anyhow::Result<()> {
    // Run raw SQL migrations sequentially
    let migrations = [
        include_str!("../../migrations/001_initial.sql"),
        include_str!("../../migrations/002_visibility_column.sql"),
    ];
    for migration in &migrations {
        sqlx::raw_sql(migration).execute(pool).await?;
    }
    tracing::info!("Database migrations applied");
    Ok(())
}
