package ffmpeg

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"log"
	"os/exec"
	"strconv"
	"strings"
)

type Metadata struct {
	Title  string
	Artist string
	Album  string
}

type Converter struct {
	Binary string
}

func New(binary string) *Converter {
	if strings.TrimSpace(binary) == "" {
		binary = "ffmpeg"
	}
	return &Converter{Binary: binary}
}

func ValidateOptions(format string, quality int) error {
	switch format {
	case "mp3":
		if quality != 128 && quality != 192 && quality != 256 && quality != 320 {
			return errors.New("คุณภาพ MP3 ต้องเป็น 128, 192, 256 หรือ 320 kbps")
		}
	case "m4a":
		if quality != 128 && quality != 192 && quality != 256 {
			return errors.New("คุณภาพ M4A ต้องเป็น 128, 192 หรือ 256 kbps")
		}
	case "flac":
		if quality != 0 {
			return errors.New("FLAC ไม่รองรับการเลือก bitrate")
		}
	default:
		return errors.New("รองรับเฉพาะ MP3, M4A และ FLAC")
	}
	return nil
}

func (c *Converter) Convert(ctx context.Context, input, cover, output, format string, quality int, metadata Metadata) error {
	return c.ConvertWithProgress(ctx, input, cover, output, format, quality, metadata, 0, nil)
}

func (c *Converter) ConvertWithProgress(ctx context.Context, input, cover, output, format string, quality int, metadata Metadata, duration float64, onProgress func(float64)) error {
	if err := ValidateOptions(format, quality); err != nil {
		return err
	}
	args := []string{"-y", "-hide_banner", "-loglevel", "error", "-progress", "pipe:1", "-i", input}
	if cover != "" {
		args = append(args, "-i", cover, "-map", "0:a:0", "-map", "1:v:0")
	} else {
		args = append(args, "-map", "0:a:0")
	}
	switch format {
	case "mp3":
		args = append(args, "-c:a", "libmp3lame", "-b:a", strconv.Itoa(quality)+"k", "-id3v2_version", "3")
	case "m4a":
		args = append(args, "-c:a", "aac", "-b:a", strconv.Itoa(quality)+"k", "-movflags", "+faststart")
	case "flac":
		args = append(args, "-c:a", "flac", "-compression_level", "8")
	}
	if cover != "" {
		args = append(args, "-c:v", "mjpeg", "-disposition:v:0", "attached_pic")
	}
	args = append(args,
		"-metadata", "title="+cleanMetadata(metadata.Title),
		"-metadata", "artist="+cleanMetadata(metadata.Artist),
		"-metadata", "album="+cleanMetadata(metadata.Album),
		output,
	)
	cmd := exec.CommandContext(ctx, c.Binary, args...)
	var diagnostics bytes.Buffer
	cmd.Stderr = &diagnostics
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return errors.New("ไม่สามารถเริ่ม FFmpeg ได้ กรุณาตรวจสอบการติดตั้ง")
	}
	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "out_time_us=") && duration > 0 && onProgress != nil {
			microseconds, _ := strconv.ParseFloat(strings.TrimPrefix(line, "out_time_us="), 64)
			onProgress(min(100, max(0, microseconds/(duration*10000))))
		}
	}
	if err := cmd.Wait(); err != nil {
		// Keep technical diagnostics on the server, never in the public API.
		detail := strings.TrimSpace(diagnostics.String())
		if len(detail) > 4096 {
			detail = detail[:4096] + "..."
		}
		log.Printf("FFmpeg conversion failed: %v; stderr=%q", err, detail)
		if errors.Is(err, exec.ErrNotFound) {
			return errors.New("เซิร์ฟเวอร์ยังไม่ได้ติดตั้ง FFmpeg")
		}
		return errors.New("แปลงไฟล์ไม่สำเร็จ กรุณาลองใหม่หรือเลือกรูปแบบอื่น")
	}
	return nil
}

func cleanMetadata(value string) string {
	value = strings.Map(func(r rune) rune {
		if r == '\x00' || r == '\r' || r == '\n' {
			return -1
		}
		return r
	}, strings.TrimSpace(value))
	if len([]rune(value)) > 300 {
		value = string([]rune(value)[:300])
	}
	return value
}
