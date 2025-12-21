use sqlx::PgPool;

pub struct Database {
    pool: PgPool,
}

impl Database {
    pub async fn new(database_url: &str) -> anyhow::Result<Self> {
        // sqlx 0.8: Use PgPoolOptions for connection
        let options = database_url
            .parse::<sqlx::postgres::PgConnectOptions>()?
            .statement_cache_capacity(0);

        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(10)
            .connect_with(options)
            .await?;
        Ok(Self { pool })
    }

    pub fn pool(&self) -> &PgPool {
        &self.pool
    }
}

