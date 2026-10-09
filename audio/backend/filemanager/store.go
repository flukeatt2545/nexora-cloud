package filemanager

import (
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var safeID = regexp.MustCompile(`^[a-zA-Z0-9_-]{8,64}$`)

type Store struct {
	root string
}

func New(root string) (*Store, error) {
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(abs, 0o700); err != nil {
		return nil, err
	}
	return &Store{root: abs}, nil
}

func (s *Store) JobDir(id string) (string, error) {
	if !safeID.MatchString(id) {
		return "", errors.New("รหัสงานไม่ถูกต้อง")
	}
	return s.withinRoot(id)
}

func (s *Store) ResultPath(id, filename string) (string, error) {
	if filepath.Base(filename) != filename || filename == "." || strings.ContainsAny(filename, `/\\`) {
		return "", errors.New("ชื่อไฟล์ไม่ถูกต้อง")
	}
	dir, err := s.JobDir(id)
	if err != nil {
		return "", err
	}
	return ensureWithin(dir, filepath.Join(dir, filename))
}

func (s *Store) Remove(id string) error {
	dir, err := s.JobDir(id)
	if err != nil {
		return err
	}
	return os.RemoveAll(dir)
}

func (s *Store) withinRoot(name string) (string, error) {
	return ensureWithin(s.root, filepath.Join(s.root, name))
}

func ensureWithin(root, target string) (string, error) {
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	absTarget, err := filepath.Abs(target)
	if err != nil {
		return "", err
	}
	rel, err := filepath.Rel(absRoot, absTarget)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", errors.New("ไม่อนุญาตให้เข้าถึงไฟล์นอกพื้นที่งาน")
	}
	return absTarget, nil
}
