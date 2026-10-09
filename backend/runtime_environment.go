package main

import (
	"net"
	"net/url"
	"strings"
)

const (
	runtimeDevelopment = "development"
	runtimeProduction  = "production"
)

func resolveRuntimeEnvironment(explicit string, publicOrigins ...string) (string, string) {
	value := strings.ToLower(strings.TrimSpace(explicit))
	if value != "" && value != "auto" {
		return value, "explicit"
	}
	for _, origin := range publicOrigins {
		if isExternalHTTPSOrigin(origin) {
			return runtimeProduction, "auto"
		}
	}
	return runtimeDevelopment, "auto"
}

func isExternalHTTPSOrigin(value string) bool {
	parsed, err := url.Parse(strings.TrimSpace(value))
	return err == nil && strings.EqualFold(parsed.Scheme, "https") && parsed.Hostname() != "" && !isLocalRuntimeHost(parsed.Hostname())
}

func isLocalRuntimeHost(host string) bool {
	host = strings.TrimSuffix(strings.ToLower(strings.Trim(strings.TrimSpace(host), "[]")), ".")
	if host == "localhost" || strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".local") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && (ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified())
}

func normalizedOrigin(value string) (string, *url.URL, bool) {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.User != nil {
		return "", nil, false
	}
	parsed.Scheme = strings.ToLower(parsed.Scheme)
	parsed.Host = strings.ToLower(parsed.Host)
	return parsed.Scheme + "://" + parsed.Host, parsed, true
}

func loadAllowedOrigins(environment, configured, cfDomain string) map[string]bool {
	origins := map[string]bool{}
	for _, value := range strings.Split(configured, ",") {
		origin, parsed, ok := normalizedOrigin(value)
		if !ok || (environment == runtimeProduction && isLocalRuntimeHost(parsed.Hostname())) {
			continue
		}
		origins[origin] = true
	}
	domain := strings.TrimSpace(strings.ToLower(cfDomain))
	if domain != "" {
		origins["https://"+domain] = true
		origins["https://www."+domain] = true
		if environment == runtimeDevelopment {
			origins["http://"+domain] = true
			origins["http://www."+domain] = true
		}
	}
	return origins
}

func trustedRuntimeOrigin(environment, rawOrigin string, hosts ...string) bool {
	_, parsed, ok := normalizedOrigin(rawOrigin)
	if !ok || (environment == runtimeProduction && parsed.Scheme != "https") {
		return false
	}
	for _, host := range hosts {
		candidate := strings.TrimSpace(host)
		if parsedHost, _, err := net.SplitHostPort(candidate); err == nil {
			candidate = parsedHost
		}
		candidate = strings.Trim(candidate, "[]")
		if strings.EqualFold(parsed.Hostname(), candidate) {
			return true
		}
	}
	return false
}
