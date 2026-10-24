package main

import (
	"testing"
	"time"
)

func day(value string) time.Time {
	parsed, _ := time.Parse("2006-01-02", value)
	return parsed
}

func TestResolveSiteTheme(t *testing.T) {
	halloween := themeRule{ID: "h", Theme: "halloween", Start: "2000-10-25", End: "2000-11-01", Yearly: true, Enabled: true}
	newYear := themeRule{ID: "n", Theme: "christmas", Start: "2000-12-20", End: "2001-01-02", Yearly: true, Enabled: true}
	oneOff := themeRule{ID: "o", Theme: "cyberpunk", Start: "2026-03-01", End: "2026-03-07", Enabled: true}

	cases := []struct {
		name  string
		base  string
		rules []themeRule
		today string
		want  string
	}{
		{"no rules uses the base", "default", nil, "2026-10-28", "default"},
		{"a yearly rule covers its days in any year", "default", []themeRule{halloween}, "2031-10-30", "halloween"},
		{"the first and last day are included", "default", []themeRule{halloween}, "2026-10-25", "halloween"},
		{"the last day is included", "default", []themeRule{halloween}, "2026-11-01", "halloween"},
		{"the day before and after are not", "default", []themeRule{halloween}, "2026-10-24", "default"},
		{"the day after is not", "default", []themeRule{halloween}, "2026-11-02", "default"},
		{"a yearly rule can run over New Year (before)", "default", []themeRule{newYear}, "2026-12-25", "christmas"},
		{"a yearly rule can run over New Year (after)", "default", []themeRule{newYear}, "2027-01-02", "christmas"},
		{"a yearly rule can run over New Year (outside)", "default", []themeRule{newYear}, "2027-01-03", "default"},
		{"a one-off rule counts only in its own year", "default", []themeRule{oneOff}, "2027-03-03", "default"},
		{"a one-off rule inside its dates", "default", []themeRule{oneOff}, "2026-03-03", "cyberpunk"},
		{"a rule that is switched off does nothing", "default", []themeRule{{Theme: "halloween", Start: "2000-10-25", End: "2000-11-01", Yearly: true}}, "2026-10-28", "default"},
		{"the first rule in the list wins", "default", []themeRule{{ID: "a", Theme: "songkran", Start: "2000-10-01", End: "2000-10-31", Yearly: true, Enabled: true}, halloween}, "2026-10-28", "songkran"},
		{"outside every rule the base theme stays", "cyberpunk", []themeRule{halloween}, "2026-06-01", "cyberpunk"},
		{"a rule overrides the base", "cyberpunk", []themeRule{halloween}, "2026-10-28", "halloween"},
		{"an unknown base falls back to the plain look", "sparkles", nil, "2026-06-01", "default"},
	}
	for _, item := range cases {
		got, _ := resolveSiteTheme(item.base, item.rules, day(item.today))
		if got != item.want {
			t.Errorf("%s: got %s, want %s", item.name, got, item.want)
		}
	}
}

func TestResolveSiteThemeNamesTheRule(t *testing.T) {
	rules := []themeRule{{ID: "h", Theme: "halloween", Start: "2000-10-25", End: "2000-11-01", Yearly: true, Enabled: true}}
	if _, rule := resolveSiteTheme("default", rules, day("2026-10-30")); rule == nil || rule.ID != "h" {
		t.Error("the rule that turned the theme on should be named")
	}
	if _, rule := resolveSiteTheme("default", rules, day("2026-06-30")); rule != nil {
		t.Error("no rule should be named outside the dates")
	}
}

func TestCleanThemeRules(t *testing.T) {
	good := themeRule{Theme: "halloween", Start: "2026-10-25", End: "2026-11-01", Yearly: true, Enabled: true, Label: "  ฮาโลวีน  "}
	rules, problem := cleanThemeRules([]themeRule{good, good})
	if problem != "" || len(rules) != 2 {
		t.Fatalf("two valid rules should pass: %q", problem)
	}
	if rules[0].Label != "ฮาโลวีน" || rules[0].ID == "" || rules[0].ID == rules[1].ID {
		t.Errorf("labels are trimmed and every rule gets its own id: %+v", rules)
	}
	for name, bad := range map[string]themeRule{
		"the plain look is not a themed range": {Theme: "default", Start: "2026-10-25", End: "2026-11-01", Enabled: true},
		"an unknown theme":                     {Theme: "sparkles", Start: "2026-10-25", End: "2026-11-01", Enabled: true},
		"a bad date":                           {Theme: "halloween", Start: "2026-13-40", End: "2026-11-01", Enabled: true},
		"an ending before the start":           {Theme: "halloween", Start: "2026-11-02", End: "2026-11-01", Enabled: true},
	} {
		if _, problem := cleanThemeRules([]themeRule{bad}); problem == "" {
			t.Errorf("%s should be refused", name)
		}
	}
	// An ending before the start is fine for a yearly rule: it runs over New Year.
	if _, problem := cleanThemeRules([]themeRule{{Theme: "christmas", Start: "2026-12-20", End: "2026-01-02", Yearly: true, Enabled: true}}); problem != "" {
		t.Errorf("a yearly rule over New Year should pass: %s", problem)
	}
	if _, problem := cleanThemeRules(make([]themeRule, maxThemeRules+1)); problem == "" {
		t.Error("too many rules should be refused")
	}
}
