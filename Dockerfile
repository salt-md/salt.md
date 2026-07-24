# --- Frontend build (its output is the same for every target arch) ---
FROM --platform=$BUILDPLATFORM node:20-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json* ./
RUN npm ci || npm install
COPY web ./
RUN npm run build

# --- Backend build (cross-compiled to the requested target arch) ---
FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS build
ARG TARGETOS
ARG TARGETARCH
ARG VERSION=dev
WORKDIR /src
COPY go.mod go.sum* ./
RUN go mod download || true
COPY . .
COPY --from=web /src/web/dist ./web/dist
# CGO off + pure-Go SQLite ⇒ a fully static binary, and building on the native
# builder while targeting $TARGETARCH avoids slow QEMU emulation of the compiler.
RUN go mod tidy && CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -trimpath -ldflags="-s -w -X salt/server.Version=${VERSION}" -o /salt .

# --- Runtime ---
FROM alpine:3.20
RUN adduser -D -H salt && mkdir -p /data && chown salt /data
USER salt
ENV SALT_ADDR=:8420 SALT_DATA=/data
VOLUME /data
EXPOSE 8420
COPY --from=build /salt /usr/local/bin/salt
ENTRYPOINT ["salt"]
