use sqlx::PgPool;
use std::time::Duration;
use url::Url;

#[derive(Debug, serde::Deserialize)]
struct DnsJsonResponse {
    #[serde(default)]
    #[serde(rename = "Answer")]
    answer: Vec<DnsJsonAnswer>,
}

#[derive(Debug, serde::Deserialize)]
struct DnsJsonAnswer {
    #[serde(rename = "type")]
    record_type: u32,
    data: String,
}

pub struct Database {
    pool: PgPool,
}

impl Database {
    pub async fn new(database_url: &str) -> anyhow::Result<Self> {
        let database_url = database_url.trim();
        match Self::connect(database_url).await {
            Ok(pool) => Ok(Self { pool }),
            Err(e) => {
                if !Self::looks_like_dns_error(&e) {
                    return Err(e);
                }

                let normalized_url = Self::normalize_supabase_port(database_url)
                    .unwrap_or_else(|| database_url.to_string());
                if normalized_url != database_url {
                    if let Ok(pool) = Self::connect(&normalized_url).await {
                        return Ok(Self { pool });
                    }
                }

                let fallback_base_url = if normalized_url != database_url {
                    normalized_url.as_str()
                } else {
                    database_url
                };

                let Some((ip, host, record_kind)) =
                    Self::resolve_host_ip_via_doh(fallback_base_url).await?
                else {
                    return Err(e);
                };

                let pool = Self::connect_with_host_override(fallback_base_url, &ip)
                    .await
                    .map_err(|fallback_err| {
                        let hint = if record_kind == "AAAA" {
                            "\nHint: your DNS resolved an IPv6-only address. If your network is IPv4-only, use Supabase Connection Pooling (pooler) DATABASE_URL instead, or enable IPv6."
                        } else {
                            ""
                        };
                        anyhow::anyhow!(
                            "{}\nFallback (DoH {} record for {} -> {}) attempt also failed: {}{}",
                            e,
                            record_kind,
                            host,
                            ip,
                            fallback_err,
                            hint
                        )
                    })?;

                Ok(Self { pool })
            }
        }
    }

    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

    async fn connect(database_url: &str) -> anyhow::Result<PgPool> {
        let options = database_url
            .parse::<sqlx::postgres::PgConnectOptions>()?
            .statement_cache_capacity(0);

        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(10)
            .acquire_timeout(Duration::from_secs(20))
            .connect_with(options)
            .await?;

        Ok(pool)
    }

    async fn connect_with_host_override(database_url: &str, host: &str) -> anyhow::Result<PgPool> {
        let options = database_url
            .parse::<sqlx::postgres::PgConnectOptions>()?
            .host(host)
            .statement_cache_capacity(0);

        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(10)
            .acquire_timeout(Duration::from_secs(20))
            .connect_with(options)
            .await?;

        Ok(pool)
    }

    fn looks_like_dns_error(err: &anyhow::Error) -> bool {
        let message = err.to_string();
        message.contains("No such host is known")
            || message.contains("failed to lookup address information")
            || message.contains("name resolution")
            || message.contains("dns error")
    }

    fn normalize_supabase_port(database_url: &str) -> Option<String> {
        let url = Url::parse(database_url).ok()?;
        let host = url.host_str()?.to_string();
        let port = url.port();

        if port != Some(6543) {
            return None;
        }

        if !host.starts_with("db.") || !host.ends_with(".supabase.co") {
            return None;
        }

        let mut updated = url;
        let _ = updated.set_port(Some(5432));
        Some(updated.to_string())
    }

    async fn resolve_host_ip_via_doh(
        database_url: &str,
    ) -> anyhow::Result<Option<(String, String, &'static str)>> {
        let url = Url::parse(database_url)?;
        let Some(host) = url.host_str().map(|s| s.to_string()) else {
            return Ok(None);
        };

        if host == "localhost" || host.parse::<std::net::IpAddr>().is_ok() {
            return Ok(None);
        }

        let Some((ip, record_kind)) = Self::resolve_ip_via_doh(&host).await? else {
            return Ok(None);
        };

        Ok(Some((ip, host, record_kind)))
    }

    async fn resolve_ip_via_doh(host: &str) -> anyhow::Result<Option<(String, &'static str)>> {
        let client = reqwest::Client::new();
        let url_a = format!("https://cloudflare-dns.com/dns-query?name={}&type=A", host);

        let resp_a = client
            .get(url_a)
            .header("accept", "application/dns-json")
            .send()
            .await?
            .error_for_status()?;

        let parsed_a = resp_a.json::<DnsJsonResponse>().await?;
        for answer in parsed_a.answer {
            if answer.record_type == 1 && answer.data.parse::<std::net::Ipv4Addr>().is_ok() {
                return Ok(Some((answer.data, "A")));
            }
        }

        let url_aaaa = format!(
            "https://cloudflare-dns.com/dns-query?name={}&type=AAAA",
            host
        );
        let resp_aaaa = client
            .get(url_aaaa)
            .header("accept", "application/dns-json")
            .send()
            .await?
            .error_for_status()?;

        let parsed_aaaa = resp_aaaa.json::<DnsJsonResponse>().await?;
        for answer in parsed_aaaa.answer {
            if answer.record_type == 28 && answer.data.parse::<std::net::Ipv6Addr>().is_ok() {
                return Ok(Some((answer.data, "AAAA")));
            }
        }

        Ok(None)
    }
}
