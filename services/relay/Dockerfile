# Stage 1: Generate dependency recipe for caching
FROM --platform=$BUILDPLATFORM rust:1.88-slim AS chef
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
RUN cargo install cargo-chef --locked
WORKDIR /app
COPY Cargo.toml Cargo.lock* ./
COPY src/ src/
RUN cargo chef prepare --recipe-path recipe.json

# Stage 2: Build dependencies + source with cross-compilation
FROM --platform=$BUILDPLATFORM rust:1.88-slim AS builder
ARG TARGETPLATFORM
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
RUN cargo install cargo-chef --locked && cargo install cargo-zigbuild --locked
# Install zig for cross-compilation
RUN apt-get update && apt-get install -y curl xz-utils && \
    ZIG_VERSION=0.13.0 && \
    ARCH=$(uname -m) && \
    curl -L "https://ziglang.org/download/${ZIG_VERSION}/zig-linux-${ARCH}-${ZIG_VERSION}.tar.xz" | tar -xJ -C /usr/local && \
    ln -s /usr/local/zig-linux-${ARCH}-${ZIG_VERSION}/zig /usr/local/bin/zig && \
    rm -rf /var/lib/apt/lists/*
# Add Rust targets for cross-compilation
RUN rustup target add x86_64-unknown-linux-gnu aarch64-unknown-linux-gnu
# Map Docker platform to Rust target
RUN case "$TARGETPLATFORM" in \
      "linux/amd64") echo "x86_64-unknown-linux-gnu" > /target.txt ;; \
      "linux/arm64") echo "aarch64-unknown-linux-gnu" > /target.txt ;; \
      *) echo "Unsupported platform: $TARGETPLATFORM" && exit 1 ;; \
    esac

WORKDIR /app
# Cache dependencies
COPY --from=chef /app/recipe.json recipe.json
RUN cargo chef cook --release --zigbuild --target $(cat /target.txt) --recipe-path recipe.json
# Build source
COPY Cargo.toml Cargo.lock* ./
COPY src/ src/
COPY migrations/ migrations/
RUN cargo zigbuild --release --target $(cat /target.txt) && \
    cp target/$(cat /target.txt)/release/thewired-relay /app/thewired-relay

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/thewired-relay /usr/local/bin/
COPY --from=builder /app/migrations /migrations
RUN groupadd -r app && useradd -r -g app app
USER app
EXPOSE 7777
CMD ["thewired-relay"]
