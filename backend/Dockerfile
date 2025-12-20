# Build Stage
FROM rust:1.75 as builder
WORKDIR /app
COPY . .
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
