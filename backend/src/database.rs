use sqlx::PgPool;

pub struct Database {
    pool: PgPool,
}

impl Database {
    pub async fn new(database_url: &str) -> anyhow::Result<Self> {
        let mut options = database_url
            .parse::<sqlx::postgres::PgConnectOptions>()?
            .statement_cache_capacity(0);

        // FIX: Switch from Supabase Transaction Pooler (6543) to Direct Connection (5432)
        // This avoids "prepared statement already exists" errors with sqlx
        if options.get_port() == 6543 {
            tracing::info!("🔄 Switching from Transaction Pooler (6543) to Direct Connection (5432)");
            options = options.port(5432);
        }

        let pool = sqlx::postgres::PgPoolOptions::new()
            .connect_with(options)
            .await?;
            
        Ok(Self { pool })
    }

    pub fn pool(&self) -> &PgPool {
        &self.pool
    }
}

