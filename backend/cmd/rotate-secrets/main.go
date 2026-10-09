package main

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"strings"

	"github.com/jackc/pgx/v5"
)

func parsePassphrases(passphrase string) []string {
	parts := strings.Split(passphrase, ",")
	res := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			res = append(res, p)
		}
	}
	if len(res) == 0 && passphrase != "" {
		res = append(res, passphrase)
	}
	return res
}

func encryptSecret(secret, passphrase string) (string, error) {
	if secret == "" {
		return "", nil
	}
	key := sha256.Sum256([]byte(passphrase))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err = io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nonce, nonce, []byte(secret), nil)
	return base64.RawStdEncoding.EncodeToString(sealed), nil
}

func decryptSecret(ciphertext string, passphrases []string) (string, error) {
	if ciphertext == "" {
		return "", nil
	}
	raw, err := base64.RawStdEncoding.DecodeString(ciphertext)
	if err != nil {
		return "", err
	}
	var lastErr error
	for _, keyStr := range passphrases {
		key := sha256.Sum256([]byte(keyStr))
		block, err := aes.NewCipher(key[:])
		if err != nil {
			lastErr = err
			continue
		}
		gcm, err := cipher.NewGCM(block)
		if err != nil || len(raw) < gcm.NonceSize() {
			lastErr = errors.New("invalid ciphertext")
			continue
		}
		plain, err := gcm.Open(nil, raw[:gcm.NonceSize()], raw[gcm.NonceSize():], nil)
		if err == nil {
			return string(plain), nil
		}
		lastErr = err
	}
	return "", fmt.Errorf("cannot decrypt secret: %w", lastErr)
}

func main() {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatal("DATABASE_URL environment variable is required")
	}
	keysRaw := os.Getenv("HOSTING_ENCRYPTION_KEY")
	if keysRaw == "" {
		log.Fatal("HOSTING_ENCRYPTION_KEY environment variable is required")
	}
	keys := parsePassphrases(keysRaw)
	if len(keys) == 0 {
		log.Fatal("No valid encryption keys found")
	}
	primaryKey := keys[0]
	log.Printf("Starting secret rotation using primary key: %s... (total %d keys provided)", primaryKey[:min(8, len(primaryKey))], len(keys))

	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dbURL)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer conn.Close(ctx)

	tx, err := conn.Begin(ctx)
	if err != nil {
		log.Fatalf("Failed to begin transaction: %v", err)
	}
	defer tx.Rollback(ctx)

	rows, err := tx.Query(ctx, `SELECT id, name, value_ciphertext FROM hosting_environment_variables FOR UPDATE`)
	if err != nil {
		log.Fatalf("Query failed: %v", err)
	}

	type envVar struct {
		id         int64
		name       string
		ciphertext string
	}
	var vars []envVar
	for rows.Next() {
		var v envVar
		if err := rows.Scan(&v.id, &v.name, &v.ciphertext); err != nil {
			log.Fatalf("Scan failed: %v", err)
		}
		vars = append(vars, v)
	}
	rows.Close()

	rotatedCount := 0
	for _, v := range vars {
		decrypted, err := decryptSecret(v.ciphertext, keys)
		if err != nil {
			log.Fatalf("Failed to decrypt variable %s (id=%d): %v", v.name, v.id, err)
		}
		reEncrypted, err := encryptSecret(decrypted, primaryKey)
		if err != nil {
			log.Fatalf("Failed to re-encrypt variable %s (id=%d): %v", v.name, v.id, err)
		}

		_, err = tx.Exec(ctx, `UPDATE hosting_environment_variables SET value_ciphertext=$1, updated_at=NOW() WHERE id=$2`, reEncrypted, v.id)
		if err != nil {
			log.Fatalf("Failed to update variable %s (id=%d): %v", v.name, v.id, err)
		}
		rotatedCount++
	}

	if err := tx.Commit(ctx); err != nil {
		log.Fatalf("Failed to commit transaction: %v", err)
	}

	log.Printf("Successfully rotated and re-encrypted %d environment variables!", rotatedCount)
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
