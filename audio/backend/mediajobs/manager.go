package mediajobs

import (
	"archive/zip"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"nexora-cloud-api/downloader"
	mediaffmpeg "nexora-cloud-api/ffmpeg"
	"nexora-cloud-api/filemanager"
)

type CreateRequest struct {
	URL     string   `json:"url"`
	Format  string   `json:"format"`
	Quality int      `json:"quality"`
	Title   string   `json:"title,omitempty"`
	Artist  string   `json:"artist,omitempty"`
	Album   string   `json:"album,omitempty"`
	Tracks  []string `json:"tracks,omitempty"`
}

type Job struct {
	ID           string    `json:"id"`
	Status       string    `json:"status"`
	Stage        string    `json:"stage"`
	Progress     float64   `json:"progress"`
	CurrentItem  int       `json:"currentItem"`
	TotalItems   int       `json:"totalItems"`
	CurrentTitle string    `json:"currentTitle,omitempty"`
	Error        string    `json:"error,omitempty"`
	Filename     string    `json:"filename,omitempty"`
	CreatedAt    time.Time `json:"createdAt"`
	CompletedAt  time.Time `json:"completedAt,omitempty"`

	resultPath string
	request    CreateRequest
}

type Manager struct {
	mu         sync.RWMutex
	jobs       map[string]*Job
	downloader *downloader.Client
	converter  *mediaffmpeg.Converter
	store      *filemanager.Store
	queue      chan struct{}
}

var unsafeFilename = regexp.MustCompile(`[^\p{L}\p{M}\p{N}._ -]+`)

func New(dl *downloader.Client, converter *mediaffmpeg.Converter, store *filemanager.Store, workers int) *Manager {
	if workers < 1 || workers > 8 {
		workers = 2
	}
	manager := &Manager{jobs: make(map[string]*Job), downloader: dl, converter: converter, store: store, queue: make(chan struct{}, workers)}
	go manager.cleanupLoop(2 * time.Hour)
	return manager
}

func (m *Manager) Create(request CreateRequest) (Job, error) {
	mediaURL, err := downloader.ValidateYouTubeURL(request.URL)
	if err != nil {
		return Job{}, err
	}
	request.URL = mediaURL
	request.Format = strings.ToLower(strings.TrimSpace(request.Format))
	if err := mediaffmpeg.ValidateOptions(request.Format, request.Quality); err != nil {
		return Job{}, err
	}
	if len(request.Title) > 300 || len(request.Artist) > 300 || len(request.Album) > 300 || len(request.Tracks) > 100 {
		return Job{}, errors.New("ข้อมูลเพลงยาวหรือมีจำนวนมากเกินกำหนด")
	}
	id := strings.ReplaceAll(uuid.NewString(), "-", "")
	job := &Job{ID: id, Status: "queued", Stage: "กำลังรอคิว", Progress: 0, CreatedAt: time.Now().UTC(), request: request}
	m.mu.Lock()
	active := 0
	for _, existing := range m.jobs {
		if existing.Status == "queued" || existing.Status == "processing" {
			active++
		}
	}
	if active >= 20 {
		m.mu.Unlock()
		return Job{}, errors.New("คิวเต็ม กรุณาลองใหม่อีกสักครู่")
	}
	m.jobs[id] = job
	snapshot := m.snapshot(job)
	m.mu.Unlock()
	go m.run(id)
	return snapshot, nil
}

func (m *Manager) Get(id string) (Job, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	job, ok := m.jobs[id]
	if !ok {
		return Job{}, false
	}
	return m.snapshot(job), true
}

func (m *Manager) Result(id string) (string, string, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	job, ok := m.jobs[id]
	if !ok || job.Status != "completed" || job.resultPath == "" {
		return "", "", false
	}
	return job.resultPath, job.Filename, true
}

func (m *Manager) run(id string) {
	m.queue <- struct{}{}
	defer func() { <-m.queue }()
	m.update(id, func(job *Job) {
		job.Status = "processing"
		job.Stage = "กำลังตรวจสอบข้อมูล"
		job.Progress = 2
	})
	m.mu.RLock()
	request := m.jobs[id].request
	m.mu.RUnlock()

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Minute)
	defer cancel()
	inspection, err := m.downloader.Inspect(ctx, request.URL)
	if err != nil {
		m.fail(id, err)
		return
	}
	entries := filterEntries(inspection.Entries, request.Tracks)
	if len(entries) == 0 {
		m.fail(id, errors.New("ไม่พบรายการที่เลือกในลิงก์นี้"))
		return
	}
	m.update(id, func(job *Job) { job.TotalItems = len(entries) })
	jobDir, err := m.store.JobDir(id)
	if err != nil {
		m.fail(id, err)
		return
	}
	if err := os.MkdirAll(jobDir, 0o700); err != nil {
		m.fail(id, errors.New("ไม่สามารถเตรียมพื้นที่ไฟล์ได้"))
		return
	}

	outputs := make([]string, 0, len(entries))
	for index, media := range entries {
		itemDir := filepath.Join(jobDir, fmt.Sprintf("item-%03d", index+1))
		base := float64(index) / float64(len(entries)) * 94
		span := 94 / float64(len(entries))
		m.update(id, func(job *Job) {
			job.CurrentItem = index + 1
			job.CurrentTitle = media.Title
			job.Stage = "กำลังดาวน์โหลดเสียง"
			job.Progress = 3 + base
		})
		audio, cover, err := m.downloader.Download(ctx, media, itemDir, func(percent float64) {
			m.update(id, func(job *Job) { job.Progress = 3 + base + span*(percent/100)*0.72 })
		})
		if err != nil {
			m.fail(id, fmt.Errorf("%s: %w", media.Title, err))
			return
		}
		m.update(id, func(job *Job) {
			job.Stage = "กำลังแปลงและฝังข้อมูลเพลง"
			job.Progress = 3 + base + span*0.76
		})
		title, artist, album := media.Title, media.Artist, media.Album
		if len(entries) == 1 {
			title = firstNonEmpty(request.Title, title)
			artist = firstNonEmpty(request.Artist, artist)
			album = firstNonEmpty(request.Album, album)
		} else if strings.TrimSpace(request.Album) != "" {
			album = request.Album
		} else if album == "" {
			album = inspection.Title
		}
		name := safeName(fmt.Sprintf("%02d - %s", index+1, title)) + "." + request.Format
		output := filepath.Join(jobDir, name)
		if err := m.converter.ConvertWithProgress(ctx, audio, cover, output, request.Format, request.Quality, mediaffmpeg.Metadata{Title: title, Artist: artist, Album: album}, media.Duration, func(percent float64) {
			m.update(id, func(job *Job) { job.Progress = 3 + base + span*(0.76+0.24*percent/100) })
		}); err != nil {
			m.fail(id, err)
			return
		}
		outputs = append(outputs, output)
		_ = os.RemoveAll(itemDir)
	}

	resultPath := outputs[0]
	filename := filepath.Base(resultPath)
	if len(outputs) > 1 {
		filename = safeName(inspection.Title) + ".zip"
		resultPath = filepath.Join(jobDir, filename)
		if err := zipFiles(resultPath, outputs); err != nil {
			m.fail(id, errors.New("ไม่สามารถรวมไฟล์ Playlist ได้"))
			return
		}
		for _, output := range outputs {
			_ = os.Remove(output)
		}
	}
	m.update(id, func(job *Job) {
		job.Status = "completed"
		job.Stage = "พร้อมดาวน์โหลด"
		job.Progress = 100
		job.Filename = filename
		job.resultPath = resultPath
		job.CompletedAt = time.Now().UTC()
	})
}

func (m *Manager) fail(id string, err error) {
	m.update(id, func(job *Job) {
		job.Status = "failed"
		job.Stage = "ประมวลผลไม่สำเร็จ"
		job.Error = err.Error()
		job.CompletedAt = time.Now().UTC()
	})
}

func (m *Manager) update(id string, fn func(*Job)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if job, ok := m.jobs[id]; ok {
		fn(job)
	}
}

func (m *Manager) cleanupLoop(retention time.Duration) {
	ticker := time.NewTicker(15 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		cutoff := time.Now().UTC().Add(-retention)
		var expired []string
		m.mu.Lock()
		for id, job := range m.jobs {
			if job.CreatedAt.Before(cutoff) && (job.Status == "completed" || job.Status == "failed") {
				expired = append(expired, id)
				delete(m.jobs, id)
			}
		}
		m.mu.Unlock()
		for _, id := range expired {
			_ = m.store.Remove(id)
		}
	}
}

func (m *Manager) snapshot(job *Job) Job {
	copy := *job
	copy.resultPath = ""
	copy.request = CreateRequest{}
	return copy
}

func filterEntries(entries []downloader.Media, selected []string) []downloader.Media {
	if len(selected) == 0 {
		return entries
	}
	allow := make(map[string]bool, len(selected))
	for _, id := range selected {
		if len(id) <= 64 {
			allow[id] = true
		}
	}
	filtered := make([]downloader.Media, 0, len(entries))
	for _, item := range entries {
		if allow[item.ID] {
			filtered = append(filtered, item)
		}
	}
	return filtered
}

func safeName(value string) string {
	value = unsafeFilename.ReplaceAllString(strings.TrimSpace(value), "")
	value = strings.Trim(value, " .")
	// Linux limits a filename component to 255 bytes, not characters. Reserve
	// space for the extension and truncate only at UTF-8 rune boundaries.
	runes := 0
	for index, r := range value {
		if runes == 100 || index+utf8.RuneLen(r) > 240 {
			value = value[:index]
			break
		}
		runes++
	}
	value = strings.Trim(value, " .")
	if value == "" {
		return "audio"
	}
	return value
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return "ไม่ระบุข้อมูล"
}

func zipFiles(destination string, paths []string) error {
	file, err := os.OpenFile(destination, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	archive := zip.NewWriter(file)
	for _, path := range paths {
		source, err := os.Open(path)
		if err != nil {
			archive.Close()
			file.Close()
			return err
		}
		info, err := source.Stat()
		if err != nil {
			source.Close()
			archive.Close()
			file.Close()
			return err
		}
		header, _ := zip.FileInfoHeader(info)
		header.Name = filepath.Base(path)
		header.Method = zip.Store
		writer, err := archive.CreateHeader(header)
		if err == nil {
			_, err = io.Copy(writer, source)
		}
		source.Close()
		if err != nil {
			archive.Close()
			file.Close()
			return err
		}
	}
	if err := archive.Close(); err != nil {
		file.Close()
		return err
	}
	return file.Close()
}
