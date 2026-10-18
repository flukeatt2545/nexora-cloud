package main

import (
	"archive/zip"
	"bytes"
	"strings"
	"testing"
)

func TestParseGitHubSource(t *testing.T) {
	cases := []struct{ repo, ref, wantRepo, wantRef string }{
		{"nkn-team/my-bot", "", "nkn-team/my-bot", ""},
		{"https://github.com/nkn-team/my-bot", "", "nkn-team/my-bot", ""},
		{"https://github.com/nkn-team/my-bot.git", "dev", "nkn-team/my-bot", "dev"},
		{"github.com/nkn-team/my-bot/tree/feature/slash", "", "nkn-team/my-bot", "feature/slash"},
	}
	for _, item := range cases {
		repo, ref, err := parseGitHubSource(item.repo, item.ref)
		if err != nil || repo != item.wantRepo || ref != item.wantRef {
			t.Fatalf("parseGitHubSource(%q,%q) = %q,%q,%v", item.repo, item.ref, repo, ref, err)
		}
	}
	for _, bad := range []string{"https://gitlab.com/a/b", "a", "a/b/c?x=1", "../../etc", "https://github.com.evil.com/a/b", "a/b c"} {
		if _, _, err := parseGitHubSource(bad, ""); err == nil {
			t.Fatalf("%q should be refused", bad)
		}
	}
	for _, ref := range []string{"../main", "/main", "main/", "a b"} {
		if _, _, err := parseGitHubSource("a/b", ref); err == nil {
			t.Fatalf("ref %q should be refused", ref)
		}
	}
}

func TestValidBotEntry(t *testing.T) {
	good := map[string]string{"index.js": "node", "src/bot.mjs": "node", "main.py": "python"}
	for entry, runtime := range good {
		if _, ok := validBotEntry(entry, runtime); !ok {
			t.Fatalf("%s (%s) should be allowed", entry, runtime)
		}
	}
	bad := map[string]string{"../index.js": "node", "/index.js": "node", "-r.js": "node", "main.py": "node", "index.js": "python", "node_modules/a/index.js": "node", "": "node"}
	for entry, runtime := range bad {
		if _, ok := validBotEntry(entry, runtime); ok {
			t.Fatalf("%q (%s) should be refused", entry, runtime)
		}
	}
}

func zipOf(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for name, content := range files {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = entry.Write([]byte(content))
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func TestBotSourceDropsEnvAndInstalledPackages(t *testing.T) {
	data := zipOf(t, map[string]string{
		"my-bot/index.js":                         "console.log(1)",
		"my-bot/package.json":                     `{"main":"index.js"}`,
		"my-bot/.env":                             "DISCORD_TOKEN=abc\n# note\nexport GUILD_ID=1\n",
		"my-bot/node_modules/discord.js/index.js": "x",
		"my-bot/.git/HEAD":                        "ref",
		"my-bot/Dockerfile":                       "FROM x",
	})
	files, report, err := botSourceFromZip(data)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := files["index.js"]; !ok {
		t.Fatal("the common top folder should be removed")
	}
	for name := range files {
		if strings.Contains(name, "node_modules") || strings.Contains(name, ".env") || strings.HasPrefix(name, ".git") || name == "Dockerfile" {
			t.Fatalf("%s should have been dropped", name)
		}
	}
	if !report.EnvDropped || strings.Join(report.EnvNames, ",") != "DISCORD_TOKEN,GUILD_ID" {
		t.Fatalf("env report wrong: %+v", report)
	}
	if report.Files != 2 || report.Skipped != 3 {
		t.Fatalf("counts wrong: %+v", report)
	}
	archive, err := buildBotSourceZip(files)
	if err != nil {
		t.Fatal(err)
	}
	again, _, err := botSourceFromZip(archive)
	if err != nil || len(again) != len(files) {
		t.Fatal("stored zip should read back the same files")
	}
}

func TestDetectBotEntry(t *testing.T) {
	files := map[string]sourceFile{"package.json": {Data: []byte(`{"main":"src/app.js"}`)}, "src/app.js": {Data: []byte("x")}}
	if entry, mode := detectBotEntry(files, "node", "index.js"); entry != "src/app.js" || mode != "entry" {
		t.Fatalf("got %s %s", entry, mode)
	}
	files = map[string]sourceFile{"package.json": {Data: []byte(`{"scripts":{"start":"ts-node bot.ts"}}`)}, "bot.ts": {Data: []byte("x")}}
	if _, mode := detectBotEntry(files, "node", "index.js"); mode != "npm_start" {
		t.Fatalf("a start script without a .js entry should use npm start, got %s", mode)
	}
	files = map[string]sourceFile{"bot.py": {Data: []byte("x")}}
	if entry, _ := detectBotEntry(files, "python", "main.py"); entry != "bot.py" {
		t.Fatalf("got %s", entry)
	}
}

func TestDiscordTokenShape(t *testing.T) {
	if !validDiscordTokenShape("MTIzNDU2Nzg5MDEyMzQ1Njc4OQ.GaBcDe.abcdefghijklmnopqrstuvwxyz0123456789AB") {
		t.Fatal("a normal token shape should pass")
	}
	for _, bad := range []string{"short", "has space.in it.token-token-token-token-token-token-token", strings.Repeat("a", 60)} {
		if validDiscordTokenShape(bad) {
			t.Fatalf("%q should fail", bad)
		}
	}
}

func TestBotTemplatesHaveTheirEntryFile(t *testing.T) {
	for _, runtime := range []string{"node", "python"} {
		files := botTemplateFiles(runtime, "ทดสอบ")
		entry, mode := detectBotEntry(files, runtime, defaultBotEntry(runtime))
		if _, ok := files[entry]; !ok || mode != "entry" {
			t.Fatalf("%s template: entry %s missing", runtime, entry)
		}
	}
}
