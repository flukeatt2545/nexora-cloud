package downloader

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

var percentPattern = regexp.MustCompile(`([0-9]+(?:\.[0-9]+)?)%`)

type Media struct {
	ID        string  `json:"id"`
	URL       string  `json:"url"`
	Title     string  `json:"title"`
	Artist    string  `json:"artist"`
	Album     string  `json:"album,omitempty"`
	Thumbnail string  `json:"thumbnail"`
	Duration  float64 `json:"duration"`
}

type Inspection struct {
	Kind      string  `json:"kind"`
	Title     string  `json:"title"`
	Artist    string  `json:"artist"`
	Thumbnail string  `json:"thumbnail"`
	Duration  float64 `json:"duration"`
	Count     int     `json:"count"`
	Entries   []Media `json:"entries"`
}

type rawMedia struct {
	Type       string `json:"_type"`
	Thumbnails []struct {
		URL string `json:"url"`
	} `json:"thumbnails"`
	ID        string     `json:"id"`
	Webpage   string     `json:"webpage_url"`
	URL       string     `json:"url"`
	Title     string     `json:"title"`
	Artist    string     `json:"artist"`
	Uploader  string     `json:"uploader"`
	Channel   string     `json:"channel"`
	Album     string     `json:"album"`
	Thumbnail string     `json:"thumbnail"`
	Duration  float64    `json:"duration"`
	Entries   []rawMedia `json:"entries"`
}

type Client struct {
	Binary string
}

func New(binary string) *Client {
	if strings.TrimSpace(binary) == "" {
		binary = "yt-dlp"
	}
	return &Client{Binary: binary}
}

func ValidateYouTubeURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if len(raw) == 0 || len(raw) > 2048 {
		return "", errors.New("ลิงก์ไม่ถูกต้อง")
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.User != nil {
		return "", errors.New("รองรับเฉพาะลิงก์ YouTube แบบ HTTPS")
	}
	host := strings.ToLower(strings.TrimSuffix(u.Hostname(), "."))
	allowed := host == "youtube.com" || host == "www.youtube.com" || host == "m.youtube.com" || host == "music.youtube.com" || host == "youtu.be"
	if !allowed || u.Port() != "" {
		return "", errors.New("กรุณาใช้ลิงก์จาก YouTube เท่านั้น")
	}
	return u.String(), nil
}

func (c *Client) Inspect(ctx context.Context, rawURL string) (Inspection, error) {
	mediaURL, err := ValidateYouTubeURL(rawURL)
	if err != nil {
		return Inspection{}, err
	}
	cmd := exec.CommandContext(ctx, c.Binary, "--ignore-config", "--js-runtimes", "node", "--flat-playlist", "--dump-single-json", "--no-warnings", "--skip-download", "--playlist-end", "100", "--", mediaURL)
	cmd.Stderr = nil
	out, err := cmd.Output()
	if err != nil {
		return Inspection{}, friendlyCommandError(err, "ไม่สามารถอ่านข้อมูลจาก YouTube ได้")
	}
	var raw rawMedia
	if err := json.Unmarshal(out, &raw); err != nil {
		return Inspection{}, errors.New("ข้อมูลที่ได้รับจาก YouTube ไม่สมบูรณ์")
	}
	result := Inspection{Kind: "video", Title: raw.Title, Artist: firstNonEmpty(raw.Artist, raw.Uploader, raw.Channel), Thumbnail: raw.Thumbnail, Duration: raw.Duration}
	if raw.Type == "playlist" && len(raw.Entries) == 0 {
		return Inspection{}, errors.New("Playlist นี้ไม่มีคลิปที่เปิดให้รับชม")
	}
	if len(raw.Entries) == 0 {
		result.Count = 1
		result.Entries = []Media{toMedia(raw)}
		return result, nil
	}
	result.Kind = "playlist"
	result.Count = len(raw.Entries)
	result.Entries = make([]Media, 0, len(raw.Entries))
	var total float64
	for _, entry := range raw.Entries {
		item := toMedia(entry)
		if item.URL == "" && item.ID != "" {
			item.URL = "https://www.youtube.com/watch?v=" + url.QueryEscape(item.ID)
		}
		result.Entries = append(result.Entries, item)
		total += item.Duration
		if result.Thumbnail == "" {
			result.Thumbnail = item.Thumbnail
		}
	}
	result.Duration = total
	return result, nil
}

func (c *Client) Download(ctx context.Context, media Media, dir string, onProgress func(float64)) (string, string, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", "", err
	}
	mediaURL, err := ValidateYouTubeURL(media.URL)
	if err != nil {
		return "", "", err
	}
	template := filepath.Join(dir, "source.%(ext)s")
	cmd := exec.CommandContext(ctx, c.Binary,
		"--ignore-config", "--js-runtimes", "node", "--no-playlist", "--no-warnings", "--newline",
		"--progress-template", "download:%(progress._percent_str)s",
		"--write-thumbnail", "--convert-thumbnails", "jpg",
		"-f", "bestaudio/best", "-o", template, "--", mediaURL,
	)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return "", "", err
	}
	cmd.Stderr = cmd.Stdout
	if err := cmd.Start(); err != nil {
		return "", "", friendlyCommandError(err, "ไม่สามารถเริ่มดาวน์โหลดได้")
	}
	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		match := percentPattern.FindStringSubmatch(scanner.Text())
		if len(match) == 2 && onProgress != nil {
			value, _ := strconv.ParseFloat(match[1], 64)
			onProgress(value)
		}
	}
	if err := cmd.Wait(); err != nil {
		return "", "", friendlyCommandError(err, "ดาวน์โหลดไฟล์เสียงไม่สำเร็จ")
	}
	files, err := filepath.Glob(filepath.Join(dir, "source.*"))
	if err != nil {
		return "", "", err
	}
	var audio, cover string
	for _, path := range files {
		ext := strings.ToLower(filepath.Ext(path))
		if ext == ".jpg" || ext == ".jpeg" || ext == ".png" || ext == ".webp" {
			cover = path
		} else {
			audio = path
		}
	}
	if audio == "" {
		return "", "", errors.New("ไม่พบไฟล์เสียงหลังดาวน์โหลด")
	}
	return audio, cover, nil
}

func toMedia(raw rawMedia) Media {
	if raw.Thumbnail == "" && len(raw.Thumbnails) > 0 {
		raw.Thumbnail = raw.Thumbnails[len(raw.Thumbnails)-1].URL
	}
	mediaURL := "https://www.youtube.com/watch?v=" + url.QueryEscape(raw.ID)
	if raw.ID == "" {
		mediaURL = raw.Webpage
	}
	if mediaURL == "" && strings.HasPrefix(raw.URL, "https://") {
		mediaURL = raw.URL
	}
	return Media{ID: raw.ID, URL: mediaURL, Title: raw.Title, Artist: firstNonEmpty(raw.Artist, raw.Uploader, raw.Channel), Album: raw.Album, Thumbnail: raw.Thumbnail, Duration: raw.Duration}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return "ไม่ระบุศิลปิน"
}

func friendlyCommandError(err error, fallback string) error {
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		return fmt.Errorf("%s กรุณาตรวจสอบว่าคลิปเป็นสาธารณะและยังเปิดให้รับชม", fallback)
	}
	if errors.Is(err, exec.ErrNotFound) {
		return errors.New("เซิร์ฟเวอร์ยังไม่ได้ติดตั้ง yt-dlp")
	}
	return errors.New(fallback)
}
