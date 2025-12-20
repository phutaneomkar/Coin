# Build Stage
# Using latest stable Rust to support newer dependencies
FROM rust:latest as builder
WORKDIR /app
COPY . .
# Enable offline mode for sqlx
ENV SQLX_OFFLINE=true
# Build release binary
RUN cargo build --release

# Runtime Stage
FROM debian:bookworm-slim
WORKDIR /app
# Install OpenSSL 
RUN apt-get update && apt-get install -y ca-certificates libssl-dev && rm -rf /var/lib/apt/lists/*

# Copy binary from builder
COPY --from=builder /app/target/release/crypto-backend .

# Copy .env (optional, Render usually manages env vars via dashboard, but good for defaults if used)
# COPY --from=builder /app/.env* ./

# Check if port is set via env var in code, expose default
EXPOSE 3001

# Command to run (ensure name matches Cargo.toml package name)
CMD ["./crypto-backend"]
