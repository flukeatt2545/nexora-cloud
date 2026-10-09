package main

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"strings"

	"github.com/minio/minio-go/v7"
)

const (
	maxDeploymentCompressed   = int64(256 * 1024 * 1024)
	maxDeploymentUncompressed = int64(1024 * 1024 * 1024)
	maxDeploymentFiles        = 10_000
	maxSingleFile             = int64(50 * 1024 * 1024)
)

type zipEntry struct {
	file *zip.File
	name string
}

func (w *worker) deploymentArchive(ctx context.Context, objectKey string, diskLimitMB int64) ([]byte, string, error) {
	if !strings.HasPrefix(objectKey, "deployments/") || !strings.HasSuffix(strings.ToLower(objectKey), ".zip") {
		return nil, "", fail("deployment_invalid", "ไฟล์ Deployment ไม่ถูกต้อง", false, nil)
	}
	object, err := w.store.GetObject(ctx, w.cfg.s3Bucket, objectKey, minio.GetObjectOptions{})
	if err != nil {
		return nil, "", fail("deployment_download_failed", "ดาวน์โหลดไฟล์ Deployment ไม่สำเร็จ", true, err)
	}
	defer object.Close()
	stat, err := object.Stat()
	if err != nil {
		return nil, "", fail("deployment_download_failed", "ไม่พบไฟล์ Deployment", true, err)
	}
	if stat.Size <= 0 || stat.Size > maxDeploymentCompressed {
		return nil, "", fail("deployment_too_large", "ไฟล์ Deployment มีขนาดใหญ่เกินกำหนด", false, nil)
	}
	data, err := io.ReadAll(io.LimitReader(object, maxDeploymentCompressed+1))
	if err != nil || int64(len(data)) > maxDeploymentCompressed {
		return nil, "", fail("deployment_download_failed", "อ่านไฟล์ Deployment ไม่สำเร็จ", true, err)
	}
	limit := maxDeploymentUncompressed
	if diskLimitMB > 0 && diskLimitMB*1024*1024 < limit {
		limit = diskLimitMB * 1024 * 1024
	}
	archive, names, err := zipToSafeTar(data, limit)
	if err != nil {
		return nil, "", fail("deployment_unsafe", "ไฟล์ Deployment ไม่ปลอดภัยหรือมีขนาดเกินกำหนด", false, err)
	}
	detected := detectProjectType(names)
	if err := validateDeploymentEntrypoint(names, detected); err != nil {
		return nil, "", fail("deployment_entrypoint_missing", "ไม่พบไฟล์เริ่มต้นของเว็บไซต์", false, err)
	}
	return archive, detected, nil
}

func zipToSafeTar(data []byte, byteLimit int64) ([]byte, []string, error) {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, nil, err
	}
	if len(reader.File) == 0 || len(reader.File) > maxDeploymentFiles {
		return nil, nil, errors.New("invalid file count")
	}

	entries := make([]zipEntry, 0, len(reader.File))
	for _, file := range reader.File {
		name, err := safeArchivePath(file.Name)
		if err != nil {
			return nil, nil, err
		}
		if name == "" {
			continue
		}
		mode := file.Mode()
		if mode&os.ModeSymlink != 0 || mode&(os.ModeDevice|os.ModeNamedPipe|os.ModeSocket) != 0 {
			return nil, nil, fmt.Errorf("unsupported file type: %s", name)
		}
		if !file.FileInfo().IsDir() && file.UncompressedSize64 > uint64(maxSingleFile) {
			return nil, nil, fmt.Errorf("file too large: %s", name)
		}
		entries = append(entries, zipEntry{file: file, name: name})
	}
	stripPrefix := commonRoot(entries)

	var output bytes.Buffer
	tarWriter := tar.NewWriter(&output)
	defer tarWriter.Close()
	names := make([]string, 0, len(entries))
	var total int64
	for _, entry := range entries {
		name := strings.TrimPrefix(entry.name, stripPrefix)
		name = strings.TrimPrefix(name, "/")
		if name == "" {
			continue
		}
		if blockedDeploymentPath(name) {
			return nil, nil, fmt.Errorf("blocked deployment path: %s", name)
		}
		info := entry.file.FileInfo()
		header := &tar.Header{
			Name:    name,
			ModTime: info.ModTime(),
			Uid:     10001,
			Gid:     10001,
		}
		if info.IsDir() {
			header.Typeflag = tar.TypeDir
			header.Mode = 0o755
		} else {
			header.Typeflag = tar.TypeReg
			header.Mode = 0o644
			header.Size = int64(entry.file.UncompressedSize64)
			total += header.Size
			if total > byteLimit {
				return nil, nil, errors.New("deployment exceeds workspace quota")
			}
		}
		if err := tarWriter.WriteHeader(header); err != nil {
			return nil, nil, err
		}
		if info.IsDir() {
			continue
		}
		source, err := entry.file.Open()
		if err != nil {
			return nil, nil, err
		}
		_, copyErr := io.CopyN(tarWriter, source, int64(entry.file.UncompressedSize64))
		closeErr := source.Close()
		if copyErr != nil {
			return nil, nil, copyErr
		}
		if closeErr != nil {
			return nil, nil, closeErr
		}
		names = append(names, strings.ToLower(name))
	}
	if len(names) == 0 {
		return nil, nil, errors.New("deployment has no files")
	}
	if err := tarWriter.Close(); err != nil {
		return nil, nil, err
	}
	return output.Bytes(), names, nil
}

func safeArchivePath(value string) (string, error) {
	value = strings.ReplaceAll(strings.TrimSpace(value), `\`, "/")
	if value == "" {
		return "", nil
	}
	if strings.HasPrefix(value, "/") || strings.ContainsRune(value, '\x00') {
		return "", errors.New("absolute or null path")
	}
	clean := path.Clean(value)
	if clean == "." {
		return "", nil
	}
	if clean == ".." || strings.HasPrefix(clean, "../") {
		return "", errors.New("path traversal")
	}
	return clean, nil
}

func commonRoot(entries []zipEntry) string {
	var root string
	for _, entry := range entries {
		if entry.file.FileInfo().IsDir() && !strings.Contains(entry.name, "/") {
			continue
		}
		parts := strings.Split(entry.name, "/")
		if len(parts) < 2 {
			return ""
		}
		if root == "" {
			root = parts[0]
		} else if root != parts[0] {
			return ""
		}
	}
	if root == "" {
		return ""
	}
	return root + "/"
}

func blockedDeploymentPath(value string) bool {
	value = strings.ToLower(strings.TrimPrefix(value, "./"))
	base := path.Base(value)
	return strings.HasPrefix(value, ".git/") ||
		base == ".env" || strings.HasPrefix(base, ".env.") ||
		base == "dockerfile" || base == "docker-compose.yml" || base == "compose.yml"
}

func detectProjectType(names []string) string {
	for _, name := range names {
		if strings.HasSuffix(name, ".php") {
			return "php"
		}
	}
	for _, name := range names {
		if path.Base(name) == "package.json" {
			return "node"
		}
	}
	return "static"
}

func validateDeploymentEntrypoint(names []string, projectType string) error {
	entrypoints := map[string]bool{
		"index.html":                true,
		"public/index.html":         true,
		"public_html/index.html":    true,
		"frontend/build/index.html": true,
		"frontend/dist/index.html":  true,
	}
	if projectType == "php" {
		entrypoints["index.php"] = true
		entrypoints["public/index.php"] = true
		entrypoints["public_html/index.php"] = true
		entrypoints["backend/index.php"] = true
	}
	if projectType == "node" {
		entrypoints = map[string]bool{"package.json": true}
	}
	for _, name := range names {
		if entrypoints[strings.TrimPrefix(strings.ToLower(name), "./")] {
			return nil
		}
	}
	return fmt.Errorf("no %s entrypoint", projectType)
}
