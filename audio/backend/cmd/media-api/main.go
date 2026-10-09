package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"nexora-cloud-api/downloader"
	mediaffmpeg "nexora-cloud-api/ffmpeg"
	"nexora-cloud-api/filemanager"
	"nexora-cloud-api/mediajobs"
)

type api struct {
	downloader *downloader.Client
	jobs       *mediajobs.Manager
	origin     string
}

func main() {
	root := env("MEDIA_TEMP_DIR", filepath.Join(os.TempDir(), "nexora-media"))
	store, err := filemanager.New(root)
	if err != nil {
		log.Fatalf("prepare media storage: %v", err)
	}
	workers, _ := strconv.Atoi(env("MEDIA_WORKERS", "2"))
	dl := downloader.New(env("YTDLP_BINARY", "yt-dlp"))
	manager := mediajobs.New(dl, mediaffmpeg.New(env("FFMPEG_BINARY", "ffmpeg")), store, workers)
	server := &api{downloader: dl, jobs: manager, origin: env("WEB_ORIGIN", "http://localhost:5173")}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", server.health)
	mux.HandleFunc("POST /api/media/inspect", server.inspect)
	mux.HandleFunc("POST /api/jobs", server.createJob)
	mux.HandleFunc("GET /api/jobs/{id}", server.getJob)
	mux.HandleFunc("GET /api/jobs/{id}/download", server.download)
	address := ":" + env("PORT", "8091")
	httpServer := &http.Server{Addr: address, Handler: server.middleware(mux), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 30 * time.Minute, IdleTimeout: 60 * time.Second}
	log.Printf("media API listening on %s", address)
	log.Fatal(httpServer.ListenAndServe())
}

func (a *api) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		if origin := r.Header.Get("Origin"); origin != "" && origin == a.origin {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (a *api) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (a *api) inspect(w http.ResponseWriter, r *http.Request) {
	var request struct {
		URL string `json:"url"`
	}
	if err := decodeJSON(w, r, &request); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	result, err := a.downloader.Inspect(ctx, request.URL)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (a *api) createJob(w http.ResponseWriter, r *http.Request) {
	var request mediajobs.CreateRequest
	if err := decodeJSON(w, r, &request); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	job, err := a.jobs.Create(request)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusAccepted, job)
}

func (a *api) getJob(w http.ResponseWriter, r *http.Request) {
	job, ok := a.jobs.Get(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, errors.New("ไม่พบงานนี้ หรือไฟล์หมดอายุแล้ว"))
		return
	}
	writeJSON(w, http.StatusOK, job)
}

func (a *api) download(w http.ResponseWriter, r *http.Request) {
	path, filename, ok := a.jobs.Result(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, errors.New("ไฟล์ยังไม่พร้อมดาวน์โหลด หรือหมดอายุแล้ว"))
		return
	}
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename*=UTF-8''%s", urlEncode(filename)))
	w.Header().Set("Content-Type", "application/octet-stream")
	http.ServeFile(w, r, path)
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) error {
	contentType, _, contentError := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if contentError != nil || contentType != "application/json" {
		return errors.New("กรุณาส่งข้อมูลเป็น JSON")
	}
	r.Body = http.MaxBytesReader(w, r.Body, 32*1024)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return errors.New("ข้อมูลที่ส่งมาไม่ถูกต้องหรือมี field ที่ไม่รองรับ")
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return errors.New("ส่ง JSON ได้ครั้งละหนึ่ง object เท่านั้น")
	}
	return nil
}

func writeError(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func env(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func urlEncode(value string) string {
	return strings.ReplaceAll(url.PathEscape(value), "+", "%20")
}
