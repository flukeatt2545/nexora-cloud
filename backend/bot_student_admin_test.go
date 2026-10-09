package main

import (
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

func TestIsDiscordStudentAdminIgnoresUnknownUsers(t *testing.T) {
	s := &server{cfg: config{discordAdminIDs: parseDiscordIDList("1084025347009433650")}}
	if !s.isDiscordStudentAdmin("1084025347009433650") {
		t.Fatal("allowlisted owner should be treated as student bot admin")
	}
	if s.isDiscordStudentAdmin("123456789012345678") {
		t.Fatal("a random Discord user must not inherit admin access")
	}
	if s.isDiscordStudentAdmin("") || s.isDiscordStudentAdmin("not-an-id") {
		t.Fatal("invalid Discord IDs must not be treated as admin")
	}
}

func TestClientIsAdminFlagIsIgnored(t *testing.T) {
	s := &server{cfg: config{discordAdminIDs: parseDiscordIDList("1084025347009433650")}}
	req := BotStudentTicketRequest{
		DiscordUserID: "123456789012345678",
		IsAdmin:       true,
	}
	if s.isDiscordStudentAdmin(req.DiscordUserID) {
		t.Fatal("client-supplied isAdmin must not grant access to another student's data")
	}
}

func TestEmptyDiscordAdminAllowlistDeniesEveryone(t *testing.T) {
	s := &server{cfg: config{discordAdminIDs: parseDiscordIDList("")}}
	if s.isDiscordStudentAdmin("1084025347009433650") {
		t.Fatal("empty allowlist must not grant privileged student access")
	}
}

func TestStudentAccessRevokedJSON(t *testing.T) {
	got := studentAccessRevokedJSON()
	if got.Code != "student_access_revoked" || got.Error == "" {
		t.Fatalf("unexpected revoked payload: %#v", got)
	}
}

func TestMysqlAccountNameEscapesQuotes(t *testing.T) {
	if mysqlAccountName("nxu_demo") != "'nxu_demo'@'%'" {
		t.Fatalf("unexpected account name: %q", mysqlAccountName("nxu_demo"))
	}
	if mysqlAccountName("bad'user") != "'bad''user'@'%'" {
		t.Fatalf("quotes must be escaped: %q", mysqlAccountName("bad'user"))
	}
}

func TestValidStudentCode(t *testing.T) {
	if !validStudentCode("12") || !validStudentCode("abc123") || !validStudentCode("1234567890") {
		t.Fatal("expected alphanumeric 2-10 student codes to be valid")
	}
	if validStudentCode("") || validStudentCode("1") || validStudentCode("12345678901") || validStudentCode("12-3") || validStudentCode("ab_c") {
		t.Fatal("expected invalid student codes to be rejected")
	}
}

func TestNormalizeBotStudentTicketRejectsBadInput(t *testing.T) {
	if _, _, _, err := normalizeBotStudentTicket(BotStudentTicketRequest{}); err.Code != "missing_code" {
		t.Fatalf("expected missing_code, got %#v", err)
	}
	if _, _, _, err := normalizeBotStudentTicket(BotStudentTicketRequest{StudentCode: "bad code"}); err.Code != "invalid_student_code" {
		t.Fatalf("expected invalid_student_code, got %#v", err)
	}
	if _, _, _, err := normalizeBotStudentTicket(BotStudentTicketRequest{StudentCode: "109", DiscordUserID: "not-an-id"}); err.Code != "invalid_discord_user" {
		t.Fatalf("expected invalid_discord_user, got %#v", err)
	}
	code, userID, name, err := normalizeBotStudentTicket(BotStudentTicketRequest{
		StudentCode:     " 109 ",
		DiscordUserID:   "123456789012345678",
		DiscordUsername: " alice ",
		IsAdmin:         true,
	})
	if err.Code != "" || code != "109" || userID != "123456789012345678" || name != "alice" {
		t.Fatalf("unexpected normalize result: %q %q %q %#v", code, userID, name, err)
	}
}

func TestDecideStudentDiscordBindOrder(t *testing.T) {
	caller := "111111111111111111"
	other := "222222222222222222"

	if decideStudentDiscordBind(false, caller, other, "") != studentBindBoundToOther {
		t.Fatal("bound-to-other must be decided before any revoked/rebind path")
	}
	if decideStudentDiscordBind(false, caller, "", "") != studentBindAllow {
		t.Fatal("revoked user must be allowed to rebind when the student code is free")
	}
	if decideStudentDiscordBind(false, caller, "", "108") != studentBindAlreadyMapped {
		t.Fatal("one Discord account may keep only one student code")
	}
	if decideStudentDiscordBind(true, caller, other, "108") != studentBindAllow {
		t.Fatal("allowlisted admin may inspect a code that already has an owner")
	}
	if decideStudentDiscordBind(false, caller, caller, "") != studentBindAllow {
		t.Fatal("the current owner must still be able to open their own code")
	}
}

func TestClientIsAdminCannotTakeBoundCode(t *testing.T) {
	s := &server{cfg: config{discordAdminIDs: parseDiscordIDList("1084025347009433650")}}
	req := BotStudentTicketRequest{
		StudentCode:   "109",
		DiscordUserID: "123456789012345678",
		IsAdmin:       true,
	}
	isAdmin := s.isDiscordStudentAdmin(req.DiscordUserID)
	if decideStudentDiscordBind(isAdmin, req.DiscordUserID, "999999999999999999", "") != studentBindBoundToOther {
		t.Fatal("client-supplied isAdmin must not take a student code that already has an owner")
	}
}

func TestShouldClearRevocationAfterSuccessfulRebind(t *testing.T) {
	caller := "111111111111111111"
	if !shouldClearStudentDiscordRevocation(true, "", caller) {
		t.Fatal("successful bind of a free code must clear that user's revocation")
	}
	if !shouldClearStudentDiscordRevocation(false, caller, caller) {
		t.Fatal("an already-bound owner should have a stale revocation cleared")
	}
	if shouldClearStudentDiscordRevocation(false, "222222222222222222", caller) {
		t.Fatal("must not clear revocation when the code belongs to someone else")
	}
}

func TestStudentBindSQLIsAtomicAndClearsRevocation(t *testing.T) {
	if !strings.Contains(studentDiscordBindIfFreeSQL, "COALESCE(discord_user_id, '') = ''") {
		t.Fatal("database bind must only succeed when the mapping is still free")
	}
	if !strings.Contains(studentDiscordBindWorkspaceIfFreeSQL, "COALESCE(discord_user_id, '') = ''") {
		t.Fatal("workspace bind must only succeed when the mapping is still free")
	}
	if !strings.Contains(clearStudentDiscordRevocationSQL, "DELETE FROM student_discord_revocations") {
		t.Fatal("successful rebind must delete the matching revocation row")
	}
}

func TestConcurrentFreeBindHasSingleWinner(t *testing.T) {
	const n = 32
	var bound string
	var mu sync.Mutex
	var wins int32
	var wg sync.WaitGroup
	wg.Add(n)
	for i := 0; i < n; i++ {
		i := i
		go func() {
			defer wg.Done()
			id := fmt.Sprintf("%018d", 100000000000000000+i)
			mu.Lock()
			won := claimFreeDiscordBinding(&bound, id)
			mu.Unlock()
			if won {
				atomic.AddInt32(&wins, 1)
			}
		}()
	}
	wg.Wait()
	if wins != 1 {
		t.Fatalf("expected exactly one winner, got %d", wins)
	}
	if strings.TrimSpace(bound) == "" {
		t.Fatal("expected the free mapping to stay bound to the winner")
	}
}

func TestStudentCodeBoundToOtherJSONHidesOwner(t *testing.T) {
	got := studentCodeBoundToOtherJSON()
	if got.Code != "student_code_bound_to_other" {
		t.Fatalf("unexpected code: %q", got.Code)
	}
	if strings.Contains(got.Error, "@") || strings.Contains(strings.ToLower(got.Error), "discord.com") {
		t.Fatalf("bound-to-other payload must not leak the owner: %q", got.Error)
	}
}
