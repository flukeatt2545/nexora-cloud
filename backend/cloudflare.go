package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type cloudflareAPIResponse struct {
	Success bool `json:"success"`
	Errors  []struct {
		Message string `json:"message"`
	} `json:"errors"`
	Result json.RawMessage `json:"result"`
}

func (s *server) cloudflareRequest(ctx context.Context, method, path string, input any, output any) error {
	if strings.TrimSpace(s.cfg.cfAPIToken) == "" {
		return fmt.Errorf("ยังไม่ได้ตั้งค่า Cloudflare API Token")
	}
	var body io.Reader
	if input != nil {
		encoded, err := json.Marshal(input)
		if err != nil {
			return err
		}
		body = bytes.NewReader(encoded)
	}
	req, err := http.NewRequestWithContext(ctx, method, "https://api.cloudflare.com/client/v4"+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+s.cfg.cfAPIToken)
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{Timeout: 20 * time.Second}).Do(req)
	if err != nil {
		return fmt.Errorf("เชื่อมต่อ Cloudflare ไม่สำเร็จ: %w", err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024))
	if err != nil {
		return err
	}
	var envelope cloudflareAPIResponse
	if err := json.Unmarshal(data, &envelope); err != nil {
		return fmt.Errorf("Cloudflare ตอบกลับไม่ถูกต้อง (HTTP %d)", resp.StatusCode)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 || !envelope.Success {
		message := fmt.Sprintf("Cloudflare ตอบกลับ HTTP %d", resp.StatusCode)
		if len(envelope.Errors) > 0 && envelope.Errors[0].Message != "" {
			message = envelope.Errors[0].Message
		}
		return fmt.Errorf("Cloudflare: %s", message)
	}
	if output != nil && len(envelope.Result) > 0 {
		return json.Unmarshal(envelope.Result, output)
	}
	return nil
}

func (s *server) cloudflareZoneForDomain(ctx context.Context, domain string) (string, error) {
	domain = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(domain)), ".")
	configuredDomain := strings.TrimSuffix(strings.ToLower(strings.TrimSpace(s.cfg.cfDomain)), ".")
	if s.cfg.cfZoneID != "" && configuredDomain != "" && (domain == configuredDomain || strings.HasSuffix(domain, "."+configuredDomain)) {
		return s.cfg.cfZoneID, nil
	}
	parts := strings.Split(domain, ".")
	for index := 0; index < len(parts)-1; index++ {
		candidate := strings.Join(parts[index:], ".")
		var zones []struct {
			ID string `json:"id"`
		}
		if err := s.cloudflareRequest(ctx, http.MethodGet, "/zones?name="+url.QueryEscape(candidate)+"&status=active&per_page=1", nil, &zones); err != nil {
			return "", err
		}
		if len(zones) > 0 && zones[0].ID != "" {
			return zones[0].ID, nil
		}
	}
	return "", fmt.Errorf("ไม่พบโดเมน %s ในบัญชี Cloudflare ที่เชื่อมต่อไว้", domain)
}

func cloudflareMailRecord(record map[string]any, domain string) (map[string]any, string, string, error) {
	recordType := strings.ToUpper(strings.TrimSpace(fmt.Sprint(record["type"])))
	if recordType != "MX" && recordType != "TXT" && recordType != "CNAME" {
		return nil, "", "", fmt.Errorf("ไม่รองรับ DNS record ชนิด %q", recordType)
	}
	name := strings.TrimSuffix(strings.ToLower(strings.TrimSpace(fmt.Sprint(record["name"]))), ".")
	if name == "" || name == "@" {
		name = domain
	} else if name != domain && !strings.HasSuffix(name, "."+domain) {
		name += "." + domain
	}
	content := strings.TrimSpace(fmt.Sprint(record["value"]))
	if content == "" || content == "<nil>" {
		content = strings.TrimSpace(fmt.Sprint(record["content"]))
	}
	if recordType != "TXT" {
		content = strings.TrimSuffix(content, ".")
	}
	if recordType == "TXT" && len(content) >= 2 && strings.HasPrefix(content, `"`) && strings.HasSuffix(content, `"`) {
		content = strings.Trim(content, `"`)
	}
	if content == "" || content == "<nil>" {
		return nil, "", "", fmt.Errorf("DNS record %s ไม่มีค่า", name)
	}
	payload := map[string]any{"type": recordType, "name": name, "content": content, "ttl": 1, "proxied": false}
	if recordType == "MX" {
		priority := 10
		if raw, ok := record["priority"]; ok {
			if parsed, err := strconv.Atoi(strings.TrimSpace(fmt.Sprint(raw))); err == nil {
				priority = parsed
			}
		}
		payload["priority"] = priority
	}
	return payload, recordType, name, nil
}

func (s *server) upsertCloudflareMailRecord(ctx context.Context, zoneID string, payload map[string]any, recordType, name string) error {
	var existing []struct {
		ID      string `json:"id"`
		Content string `json:"content"`
	}
	path := "/zones/" + url.PathEscape(zoneID) + "/dns_records?type=" + url.QueryEscape(recordType) + "&name=" + url.QueryEscape(name) + "&per_page=100"
	if err := s.cloudflareRequest(ctx, http.MethodGet, path, nil, &existing); err != nil {
		return err
	}
	content := fmt.Sprint(payload["content"])
	for _, record := range existing {
		if strings.TrimSuffix(record.Content, ".") == strings.TrimSuffix(content, ".") {
			return s.cloudflareRequest(ctx, http.MethodPut, "/zones/"+url.PathEscape(zoneID)+"/dns_records/"+url.PathEscape(record.ID), payload, nil)
		}
	}
	if recordType == "CNAME" && len(existing) > 0 {
		return s.cloudflareRequest(ctx, http.MethodPut, "/zones/"+url.PathEscape(zoneID)+"/dns_records/"+url.PathEscape(existing[0].ID), payload, nil)
	}
	return s.cloudflareRequest(ctx, http.MethodPost, "/zones/"+url.PathEscape(zoneID)+"/dns_records", payload, nil)
}

func (s *server) createDnsRecord(subdomain string) error {
	if s.cfg.cfAPIToken == "" || s.cfg.cfZoneID == "" || s.cfg.hostingServerIP == "" {
		return fmt.Errorf("Cloudflare config is missing")
	}

	fullDomain := fmt.Sprintf("%s.%s", subdomain, s.cfg.cfDomain)
	url := fmt.Sprintf("https://api.cloudflare.com/client/v4/zones/%s/dns_records", s.cfg.cfZoneID)

	// DNS Record payload
	// Setting proxied: true (Orange cloud) as recommended
	payload := map[string]interface{}{
		"type":    "A",
		"name":    fullDomain,
		"content": s.cfg.hostingServerIP,
		"ttl":     1, // 1 = Automatic
		"proxied": true,
	}

	b, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", url, bytes.NewBuffer(b))
	req.Header.Set("Authorization", "Bearer "+s.cfg.cfAPIToken)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("Cloudflare request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("Cloudflare API error: %s", string(body))
	}

	return nil
}

func (s *server) deleteDnsRecord(subdomain string) error {
	if s.cfg.cfAPIToken == "" || s.cfg.cfZoneID == "" {
		return nil // Ignore if not configured
	}

	fullDomain := fmt.Sprintf("%s.%s", subdomain, s.cfg.cfDomain)
	url := fmt.Sprintf("https://api.cloudflare.com/client/v4/zones/%s/dns_records?name=%s", s.cfg.cfZoneID, fullDomain)

	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("Authorization", "Bearer "+s.cfg.cfAPIToken)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	var result struct {
		Success bool `json:"success"`
		Result  []struct {
			ID string `json:"id"`
		} `json:"result"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return err
	}

	for _, record := range result.Result {
		delUrl := fmt.Sprintf("https://api.cloudflare.com/client/v4/zones/%s/dns_records/%s", s.cfg.cfZoneID, record.ID)
		delReq, _ := http.NewRequest("DELETE", delUrl, nil)
		delReq.Header.Set("Authorization", "Bearer "+s.cfg.cfAPIToken)
		delReq.Header.Set("Content-Type", "application/json")
		delResp, err := client.Do(delReq)
		if err == nil {
			delResp.Body.Close()
		}
	}

	return nil
}
