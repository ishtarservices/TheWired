FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o gateway cmd/gateway/main.go

FROM alpine:3.19
RUN apk add --no-cache ca-certificates && \
    addgroup -S app && adduser -S app -G app
COPY --from=builder /app/gateway /usr/local/bin/
USER app
EXPOSE 9080
CMD ["gateway"]
