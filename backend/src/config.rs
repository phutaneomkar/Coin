use std::env;

pub struct Config {
    pub database_url: String,
    pub database_url_fallback: Option<String>,
    pub port: u16,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let database_url_raw = env::var("DATABASE_URL")
            .map_err(|_| anyhow::anyhow!("DATABASE_URL environment variable not set"))?;
        let database_url = database_url_raw
            .trim()
            .trim_matches('"')
            .trim_matches('\'')
            .to_string();

        let database_url_fallback = env::var("DATABASE_URL_FALLBACK")
            .ok()
            .map(|raw| raw.trim().trim_matches('"').trim_matches('\'').to_string())
            .filter(|s| !s.is_empty());

        let port = env::var("PORT")
            .unwrap_or_else(|_| "3001".to_string())
            .parse::<u16>()
            .map_err(|_| anyhow::anyhow!("Invalid PORT value"))?;

        Ok(Config {
            database_url,
            database_url_fallback,
            port,
        })
    }
}
