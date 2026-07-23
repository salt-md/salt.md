# --- Frontend build ---
FROM node:20-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json* ./
RUN npm install
COPY web ./
RUN npm run build

# --- Backend build ---
FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod go.sum* ./
RUN go mod download || true
COPY . .
COPY --from=web /src/web/dist ./web/dist
RUN go mod tidy && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /salt .

# --- Runtime ---
FROM alpine:3.20
RUN adduser -D -H salt && mkdir -p /data && chown salt /data
USER salt
ENV SALT_ADDR=:8420 SALT_DATA=/data
VOLUME /data
EXPOSE 8420
COPY --from=build /salt /usr/local/bin/salt
ENTRYPOINT ["salt"]
