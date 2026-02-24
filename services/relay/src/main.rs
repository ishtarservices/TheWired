use tracing_subscriber::EnvFilter;

mod config;
mod connection;
mod db;
mod nostr;
mod protocol;
mod music;
mod relay_identity;
mod server;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let config = config::Config::from_env();
    tracing::info!("Starting {} on port {}", config.relay_name, config.port);

    let pool = db::pool::create_pool(&config.database_url).await?;
    db::pool::run_migrations(&pool).await?;

    server::run(config, pool).await
}
