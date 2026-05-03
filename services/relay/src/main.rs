use thewired_relay::{config, db, server};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();

    let log_format = std::env::var("LOG_FORMAT").unwrap_or_default();
    if log_format == "json" {
        tracing_subscriber::fmt()
            .json()
            .with_env_filter(EnvFilter::from_default_env())
            .init();
    } else {
        tracing_subscriber::fmt()
            .with_env_filter(EnvFilter::from_default_env())
            .init();
    }

    let config = config::Config::from_env();
    tracing::info!("Starting {} on port {}", config.relay_name, config.port);

    let pool = db::pool::create_pool(&config.database_url).await?;
    db::pool::run_migrations(&pool).await?;

    server::run(config, pool).await
}
