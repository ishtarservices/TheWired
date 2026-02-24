pub struct Config {
    pub database_url: String,
    pub port: u16,
    pub relay_name: String,
    pub relay_description: String,
    pub relay_secret_key: Option<String>,
}

impl Config {
    pub fn from_env() -> Self {
        Self {
            database_url: std::env::var("DATABASE_URL")
                .unwrap_or_else(|_| "postgres://thewired:thewired@localhost:5432/thewired".into()),
            port: std::env::var("RELAY_PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(7777),
            relay_name: std::env::var("RELAY_NAME")
                .unwrap_or_else(|_| "The Wired Relay".into()),
            relay_description: std::env::var("RELAY_DESCRIPTION")
                .unwrap_or_else(|_| "Custom NIP-29 relay for The Wired".into()),
            relay_secret_key: std::env::var("RELAY_SECRET_KEY").ok(),
        }
    }
}
