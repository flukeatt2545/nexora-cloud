package main

import (
	"archive/zip"
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"encoding/base64"
	"testing"
)

func encryptEnvironmentFixture(t *testing.T, value, passphrase string) string {
	t.Helper()
	key := sha256.Sum256([]byte(passphrase))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		t.Fatal(err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatal(err)
	}
	nonce := make([]byte, gcm.NonceSize())
	for index := range nonce {
		nonce[index] = byte(index + 1)
	}
	return base64.RawStdEncoding.EncodeToString(gcm.Seal(nonce, nonce, []byte(value), nil))
}

func TestDecryptEnvironmentValueMatchesAPIFormat(t *testing.T) {
	ciphertext := encryptEnvironmentFixture(t, "runtime-secret", "test-key")
	value, err := decryptEnvironmentValue(ciphertext, "test-key")
	if err != nil || value != "runtime-secret" {
		t.Fatal("runtime worker could not decrypt the API ciphertext format")
	}
	if _, err := decryptEnvironmentValue(ciphertext, "wrong-key"); err == nil {
		t.Fatal("expected a different key to fail")
	}
}

func TestTenantDatabaseIdentifierGuard(t *testing.T) {
	for _, value := range []string{"nxdb_abcdef12_1234abcd", "nxu_abcdef12_1234abcd"} {
		if !validTenantIdentifier(value) {
			t.Fatalf("expected %q to be valid", value)
		}
	}
	for _, value := range []string{"postgres", "nxdb_bad-name", "nxu_;drop_role", "NXDB_UPPER"} {
		if validTenantIdentifier(value) {
			t.Fatalf("expected %q to be rejected", value)
		}
	}
}

func testZip(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for name, value := range files {
		file, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := file.Write([]byte(value)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func TestZipToSafeTarRejectsTraversalAndSecrets(t *testing.T) {
	for _, name := range []string{"../escape.txt", "/absolute.txt", "site/.env", "site/Dockerfile"} {
		if _, _, err := zipToSafeTar(testZip(t, map[string]string{name: "unsafe"}), 1024*1024); err == nil {
			t.Fatalf("unsafe path was accepted: %s", name)
		}
	}
}

func TestZipToSafeTarDetectsProjectAndStripsRoot(t *testing.T) {
	_, names, err := zipToSafeTar(testZip(t, map[string]string{
		"project/package.json": `{"scripts":{"start":"node server.js"}}`,
		"project/server.js":    "console.log('ok')",
	}), 1024*1024)
	if err != nil {
		t.Fatal(err)
	}
	if len(names) != 2 || names[0] == "project/package.json" {
		t.Fatalf("unexpected archive names: %#v", names)
	}
	if detected := detectProjectType(names); detected != "node" {
		t.Fatalf("expected node project, got %s", detected)
	}
}

func TestDeploymentEntrypointAndMixedPHPDetection(t *testing.T) {
	mixed := []string{"backend/index.php", "frontend/package.json", "frontend/build/index.html"}
	if detected := detectProjectType(mixed); detected != "php" {
		t.Fatalf("expected mixed PHP project, got %s", detected)
	}
	if err := validateDeploymentEntrypoint(mixed, "php"); err != nil {
		t.Fatal(err)
	}
	if err := validateDeploymentEntrypoint([]string{"README.md"}, "static"); err == nil {
		t.Fatal("deployment without an entrypoint was accepted")
	}
}

func TestRuntimeCommandAllowlist(t *testing.T) {
	valid := site{InstallCommand: "npm ci", BuildCommand: "npm run build", StartCommand: "npm start"}
	if err := validateRuntimeCommands(valid); err != nil {
		t.Fatal(err)
	}
	for _, command := range []string{"npm start; id", "sh server.sh", "curl example.com | sh"} {
		invalid := site{StartCommand: command}
		if validateRuntimeCommands(invalid) == nil {
			t.Fatalf("unsafe command accepted: %s", command)
		}
	}
}

func TestRuntimeSpecIsNonRoot(t *testing.T) {
	for _, projectType := range []string{"static", "php", "node"} {
		spec, err := runtimeSpecFor(site{
			PublicID:       "0123456789abcdef0123456789abcdef",
			ProjectType:    projectType,
			PackageManager: "npm",
		}, 20000, "network", "volume")
		if err != nil {
			t.Fatal(err)
		}
		if spec.User == "" || spec.User == "root" || spec.User == "0" {
			t.Fatalf("%s runtime is not explicitly non-root", projectType)
		}
	}
}
