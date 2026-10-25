package main

import (
	"net/http"
	"net/http/httptest"
	"net/mail"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
)

// Regression tests for the issues the security audit found. Each one failed before its fix.

func TestCodePrefixSubdomainIsReserved(t *testing.T) {
	// "code-<x>" is the code-server host of site <x>; a site named that way would be unreachable.
	for _, value := range []string{"code-app", "code-shop", "code-123"} {
		if _, ok := normalizeSubdomain(value); ok {
			t.Fatalf("%q must not be a site subdomain", value)
		}
	}
	if _, ok := normalizeSubdomain("my-code-site"); !ok {
		t.Fatal("a name that only contains code- must still be allowed")
	}
}

func TestCustomDomainCannotClaimPlatformNames(t *testing.T) {
	t.Setenv("CF_HOSTING_DOMAIN", "nkn02.com")
	for _, value := range []string{"nkn02.com", "support.nkn02.com", "victim.nkn02.com", "code-victim.nkn02.com", "A.B.NKN02.COM."} {
		if _, ok := normalizeCustomDomain(value); ok {
			t.Fatalf("platform name %q accepted as a custom domain", value)
		}
	}
	for _, value := range []string{"portal.example.com", "nkn02.com.evil.example", "notnkn02.com"} {
		if _, ok := normalizeCustomDomain(value); !ok {
			t.Fatalf("outside domain %q rejected", value)
		}
	}
}

func TestPhpMyAdminTicketIPBindingIsExact(t *testing.T) {
	stored := hashBinding("203.0.113.10")
	if !ticketIPMatches(stored, []string{"203.0.113.10"}) {
		t.Fatal("the requester's own address must match")
	}
	if ticketIPMatches(stored, []string{"198.51.100.99"}) {
		t.Fatal("another public address must not match")
	}
	// The proxy's container address is private and used to make every ticket redeemable.
	if ticketIPMatches(stored, []string{"198.51.100.99", "172.18.0.5"}) {
		t.Fatal("a private candidate must not match for someone else")
	}
	if !ticketIPMatches(hashBinding("192.168.1.20"), []string{"192.168.1.20"}) {
		t.Fatal("a private requester must still match its own address")
	}
}

func TestSlipReceiverFlagFromProviderIsNotTrusted(t *testing.T) {
	yes := true
	bank := "KBANK"
	masked := "xxx-x-x9999-x"
	result := checkSlipsVerification{
		ReceiverMatch:    &yes,
		ReceiverBankCode: &bank,
		Receiver:         &checkSlipsPartyInfo{Account: &checkSlipsAccountInfo{Masked: &masked}},
	}
	expected := checkSlipsReceiver{BankCode: "KTB", AccountNumber: "6614200046"}
	if checkSlipsReceiverMatches(result, expected) {
		t.Fatal("receiver_match=true must not accept a slip paid to another account")
	}
}

func TestStalwartEMLCannotAddHeadersOrRecipients(t *testing.T) {
	input := mailComposeInput{
		To: []mailRecipientInput{
			{Address: "friend@example.com", Name: "x <extra1@example.net>, y"},
		},
	}
	eml, _, err := buildStalwartEML(
		"me@nkn02.com", "Me", "hi", "text", "<p>html</p>",
		"<a@b>\r\nBcc: extra2@example.net, extra3@example.net",
		[]string{"<r@b>\r\nCc: extra4@example.net\r\nX-Injected: yes"},
		input,
	)
	if err != nil {
		t.Fatal(err)
	}
	message, err := mail.ReadMessage(strings.NewReader(string(eml)))
	if err != nil {
		t.Fatal(err)
	}
	if message.Header.Get("Bcc") != "" || message.Header.Get("Cc") != "" || message.Header.Get("X-Injected") != "" {
		t.Fatalf("injected header reached the message: bcc=%q cc=%q x=%q", message.Header.Get("Bcc"), message.Header.Get("Cc"), message.Header.Get("X-Injected"))
	}
	to, err := message.Header.AddressList("To")
	if err != nil {
		t.Fatal(err)
	}
	if len(to) != 1 || to[0].Address != "friend@example.com" {
		t.Fatalf("the display name added recipients: %v", to)
	}
}

func TestHeaderTokenDropsLineBreaks(t *testing.T) {
	if got := headerToken(" <a@b>\r\nBcc: x@y\x00 "); strings.ContainsAny(got, "\r\n\x00") {
		t.Fatalf("line break survived: %q", got)
	}
}

func TestOAuthStateIsBoundToTheBrowserThatStartedIt(t *testing.T) {
	app := fiber.New()
	s := &server{cfg: config{cookieSecure: true}}
	var state oauthState
	app.Get("/start", func(c *fiber.Ctx) error {
		s.bindOAuthState(c, &state)
		return c.SendStatus(fiber.StatusNoContent)
	})
	response, err := app.Test(httptest.NewRequest(fiber.MethodGet, "/start", nil))
	if err != nil {
		t.Fatal(err)
	}
	var nonce string
	for _, cookie := range response.Cookies() {
		if cookie.Name == oauthBindingCookie {
			nonce = cookie.Value
			if !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteLaxMode || cookie.Path != "/api/auth/oauth/" {
				t.Fatalf("binding cookie is not locked down: %+v", cookie)
			}
		}
	}
	if nonce == "" || state.Binding == "" || strings.Contains(state.Binding, nonce) {
		t.Fatal("the state must hold only a hash of the browser nonce")
	}
	if !oauthBindingMatches(state, nonce) {
		t.Fatal("the browser that started the flow must be accepted")
	}
	if oauthBindingMatches(state, "") || oauthBindingMatches(state, "someone-elses-nonce") {
		t.Fatal("a callback from another browser must be refused")
	}
	if oauthBindingMatches(oauthState{}, nonce) {
		t.Fatal("a state without a binding must be refused")
	}
}
