# Stage 1: Generate dependency recipe for caching
FROM --platform=$BUILDPLATFORM rust:1.98-slim AS chef
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
ARG CARGO_CHEF_VERSION=0.1.78
RUN cargo install cargo-chef --locked --version "${CARGO_CHEF_VERSION}"
WORKDIR /app
COPY Cargo.toml Cargo.lock* ./
COPY src/ src/
RUN cargo chef prepare --recipe-path recipe.json

# Stage 2: Build dependencies + source with cross-compilation
FROM --platform=$BUILDPLATFORM rust:1.98-slim AS builder
ARG TARGETPLATFORM
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
ARG CARGO_CHEF_VERSION=0.1.78
ARG CARGO_ZIGBUILD_VERSION=0.24.0
RUN cargo install cargo-chef --locked --version "${CARGO_CHEF_VERSION}" && \
    cargo install cargo-zigbuild --locked --version "${CARGO_ZIGBUILD_VERSION}"
# Install zig for cross-compilation. The tarball is checksum-verified against
# the SHA-256 published in https://ziglang.org/download/index.json before it
# is unpacked, so a tampered download fails the build instead of running.
ARG ZIG_VERSION=0.13.0
ARG ZIG_SHA256_X86_64=d45312e61ebcc48032b77bc4cf7fd6915c11fa16e4aad116b66c9468211230ea
ARG ZIG_SHA256_AARCH64=041ac42323837eb5624068acd8b00cd5777dac4cf91179e8dad7a7e90dd0c556
RUN set -eux; \
    apt-get update && apt-get install -y curl xz-utils && rm -rf /var/lib/apt/lists/*; \
    ARCH="$(uname -m)"; \
    case "$ARCH" in \
      x86_64)  ZIG_SHA256="$ZIG_SHA256_X86_64" ;; \
      aarch64) ZIG_SHA256="$ZIG_SHA256_AARCH64" ;; \
      *) echo "Unsupported build architecture: $ARCH" && exit 1 ;; \
    esac; \
    TARBALL="zig-linux-${ARCH}-${ZIG_VERSION}.tar.xz"; \
    curl -fsSL -o "/tmp/${TARBALL}" "https://ziglang.org/download/${ZIG_VERSION}/${TARBALL}"; \
    echo "${ZIG_SHA256}  /tmp/${TARBALL}" | sha256sum -c -; \
    tar -xJ -C /usr/local -f "/tmp/${TARBALL}"; \
    rm -f "/tmp/${TARBALL}"; \
    ln -s "/usr/local/zig-linux-${ARCH}-${ZIG_VERSION}/zig" /usr/local/bin/zig
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
# curl: the compose healthcheck probes /health with it (the slim base has none).
RUN apt-get update && apt-get install -y ca-certificates curl && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/thewired-relay /usr/local/bin/
COPY --from=builder /app/migrations /migrations
RUN groupadd -r app && useradd -r -g app app
USER app
EXPOSE 7777
CMD ["thewired-relay"]
