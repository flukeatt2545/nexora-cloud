FROM golang:alpine AS builder
WORKDIR /src
RUN apk add --no-cache ca-certificates git
COPY go.mod go.sum ./
RUN go mod download
COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -mod=mod -trimpath -ldflags="-s -w" -o /out/api .

FROM alpine:3.22
RUN apk add --no-cache ca-certificates tzdata \
    && addgroup -S app \
    && adduser -S -G app app
USER app
COPY --from=builder /out/api /api
EXPOSE 8080
ENTRYPOINT ["/api"]
