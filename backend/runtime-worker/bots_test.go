package main

import (
	"bytes"
	"encoding/binary"
	"strings"
	"testing"
	"time"
)

func TestBotCommandNeverUsesAShell(t *testing.T) {
	cases := []struct {
		bot  botSpec
		want []string
	}{
		{botSpec{Runtime: "node", StartMode: "entry", EntryFile: "src/index.js"}, []string{"node", "src/index.js"}},
		{botSpec{Runtime: "python", StartMode: "entry", EntryFile: "main.py"}, []string{"python", "-u", "main.py"}},
		{botSpec{Runtime: "node", StartMode: "npm_start"}, []string{"npm", "start"}},
	}
	for _, item := range cases {
		got, err := botCommand(item.bot)
		if err != nil || strings.Join(got, " ") != strings.Join(item.want, " ") {
			t.Fatalf("botCommand(%+v) = %v, %v", item.bot, got, err)
		}
	}
	for _, entry := range []string{"../etc/passwd", "/app/index.js", "-e.js", "index.sh", "node_modules/x/index.js", "index.js; rm -rf /"} {
		if _, err := botCommand(botSpec{Runtime: "node", StartMode: "entry", EntryFile: entry}); err == nil {
			t.Fatalf("entry %q should be refused", entry)
		}
	}
	if _, err := botCommand(botSpec{Runtime: "python", StartMode: "npm_start"}); err == nil {
		t.Fatal("npm start must not be allowed for python")
	}
}

func dockerFrame(stream byte, text string) []byte {
	header := make([]byte, 8)
	header[0] = stream
	binary.BigEndian.PutUint32(header[4:], uint32(len(text)))
	return append(header, []byte(text)...)
}

func TestDecodeDockerLogLinesKeepsStreamsAndTimes(t *testing.T) {
	var data bytes.Buffer
	data.Write(dockerFrame(1, "2026-10-19T02:00:00.5Z ออนไลน์แล้ว\n"))
	data.Write(dockerFrame(2, "2026-10-19T02:00:01Z Error: bad token\n"))
	lines := decodeDockerLogLines(data.Bytes())
	if len(lines) != 2 {
		t.Fatalf("got %d lines", len(lines))
	}
	if lines[0].Stream != "stdout" || lines[0].Text != "ออนไลน์แล้ว" || lines[0].At.Nanosecond() != 500_000_000 {
		t.Fatalf("first line wrong: %+v", lines[0])
	}
	if lines[1].Stream != "stderr" || lines[1].Text != "Error: bad token" {
		t.Fatalf("second line wrong: %+v", lines[1])
	}
}

func TestRedactBotLogHidesTokensAndSecrets(t *testing.T) {
	token := "MTIzNDU2Nzg5MDEyMzQ1Njc4OQ.GaBcDe.abcdefghijklmnopqrstuvwxyz0123456789AB"
	out := redactBotLog("login with "+token+" and key sk-live-secret-value", []string{"sk-live-secret-value"})
	if strings.Contains(out, token) || strings.Contains(out, "sk-live-secret-value") {
		t.Fatalf("secret left in log: %s", out)
	}
}

func TestBotLogTextKeepsThaiIntactWhenCut(t *testing.T) {
	long := strings.Repeat("ก", 5000)
	out := botLogText(long + "\x00")
	if len([]rune(out)) != 4000 || !strings.HasPrefix(long, out) {
		t.Fatal("log text must be cut on a character boundary")
	}
	if botLogText("bad \xff byte") != "bad  byte" {
		t.Fatal("invalid UTF-8 must be dropped before it reaches PostgreSQL")
	}
}

func TestRecordBotCrashesUsesWindow(t *testing.T) {
	w := &worker{bots: newBotState()}
	start := time.Now()
	if got := w.recordBotCrashes(1, 3, start); got != 3 {
		t.Fatalf("got %d", got)
	}
	if got := w.recordBotCrashes(1, 1, start.Add(botCrashWindow+time.Second)); got != 1 {
		t.Fatalf("old crashes should fall out of the window, got %d", got)
	}
}

func TestParseDuTotal(t *testing.T) {
	lines := []botLogLine{{Stream: "stdout", Text: "12\t/w"}, {Stream: "stdout", Text: "3\t/d"}, {Stream: "stderr", Text: "99 denied"}}
	if got := parseDuTotal(lines); got != 15 {
		t.Fatalf("got %d", got)
	}
}
