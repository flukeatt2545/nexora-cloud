package main

import (
	"context"
	"encoding/json"
	"log"
	"sort"
	"time"

	"github.com/gofiber/fiber/v2"
)

// New-mail DMs. The bot polls every 30 seconds; for each subscription the API asks Stalwart
// what changed since the saved Email state and returns the new inbox messages.

const (
	mailNotifyPerMailbox = 5
	mailNotifyLockKey    = "mailbot:notify:lock"
)

type mailNotifyMessage struct {
	ID       string    `json:"id"`
	From     string    `json:"from"`
	FromName string    `json:"fromName"`
	Subject  string    `json:"subject"`
	Preview  string    `json:"preview"`
	Date     time.Time `json:"date"`
}

type mailNotifyItem struct {
	DiscordUserID string              `json:"discordUserId"`
	MailboxID     string              `json:"mailboxId"`
	Address       string              `json:"address"`
	Total         int                 `json:"total"`
	Messages      []mailNotifyMessage `json:"messages"`
}

// stalwartEmailState returns the account's current Email state without loading any message.
func (s *server) stalwartEmailState(ctx context.Context, accountID string) (string, error) {
	raw, err := s.stalwartMethod(ctx, "Email/get", map[string]any{"accountId": accountID, "ids": []string{}})
	if err != nil {
		return "", err
	}
	var result struct {
		State string `json:"state"`
	}
	err = json.Unmarshal(raw, &result)
	return result.State, err
}

func (s *server) botMailNotifyPoll(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	if ok, err := s.redis.SetNX(c.Context(), mailNotifyLockKey, "1", 25*time.Second).Result(); err != nil || !ok {
		return c.JSON(fiber.Map{"items": []mailNotifyItem{}})
	}
	defer s.redis.Del(context.Background(), mailNotifyLockKey)
	ctx, cancel := context.WithTimeout(c.Context(), 20*time.Second)
	defer cancel()

	// Subscriptions whose member lost access to the mailbox are dropped first.
	if _, err := s.db.Exec(ctx, `
		DELETE FROM mail_bot_notify_subscriptions sub
		WHERE NOT EXISTS (
			SELECT 1 FROM mailboxes m JOIN mail_domains d ON d.id=m.domain_id
			WHERE m.id=sub.mailbox_id AND m.deleted_at IS NULL AND d.deleted_at IS NULL AND d.status='active' AND m.status='active'
			  AND (
			    EXISTS (SELECT 1 FROM mailbox_members mm JOIN oauth_accounts oa ON oa.user_id=mm.user_id
			            WHERE mm.mailbox_id=m.id AND oa.provider='discord' AND oa.provider_user_id=sub.discord_user_id)
			    OR EXISTS (SELECT 1 FROM mail_discord_bindings b WHERE b.mailbox_id=m.id AND b.discord_user_id=sub.discord_user_id)
			  )
		)
	`); err != nil {
		return err
	}
	rows, err := s.db.Query(ctx, `
		SELECT sub.id, sub.discord_user_id, sub.jmap_state, m.public_id, m.local_part || '@' || d.domain, m.stalwart_account_id
		FROM mail_bot_notify_subscriptions sub
		JOIN mailboxes m ON m.id=sub.mailbox_id
		JOIN mail_domains d ON d.id=m.domain_id
		WHERE COALESCE(m.stalwart_account_id,'') <> ''
		ORDER BY sub.id
		LIMIT 500
	`)
	if err != nil {
		return err
	}
	type subscription struct {
		id                                            int64
		discordID, state, mailboxID, address, account string
	}
	subs := []subscription{}
	for rows.Next() {
		var sub subscription
		if err := rows.Scan(&sub.id, &sub.discordID, &sub.state, &sub.mailboxID, &sub.address, &sub.account); err != nil {
			rows.Close()
			return err
		}
		subs = append(subs, sub)
	}
	rows.Close()

	inboxes := map[string]string{}
	items := []mailNotifyItem{}
	for _, sub := range subs {
		if ctx.Err() != nil {
			break
		}
		newState, messages, total, err := s.mailNotifyChanges(ctx, sub.account, sub.state, inboxes)
		if err != nil {
			log.Printf("mail notify: subscription %d: %v", sub.id, err)
			continue
		}
		if newState != sub.state {
			_, _ = s.db.Exec(ctx, `UPDATE mail_bot_notify_subscriptions SET jmap_state=$2, last_notified_at=CASE WHEN $3 THEN NOW() ELSE last_notified_at END WHERE id=$1`, sub.id, newState, total > 0)
		}
		if total > 0 {
			items = append(items, mailNotifyItem{DiscordUserID: sub.discordID, MailboxID: sub.mailboxID, Address: sub.address, Total: total, Messages: messages})
		}
	}
	return c.JSON(fiber.Map{"items": items})
}

// mailNotifyChanges returns the new state and the unread inbox messages created since state.
// An empty or expired state is replaced with the current one and reports nothing.
func (s *server) mailNotifyChanges(ctx context.Context, accountID, state string, inboxes map[string]string) (string, []mailNotifyMessage, int, error) {
	if state == "" {
		current, err := s.stalwartEmailState(ctx, accountID)
		return current, nil, 0, err
	}
	raw, err := s.stalwartMethod(ctx, "Email/changes", map[string]any{"accountId": accountID, "sinceState": state, "maxChanges": 100})
	if err != nil {
		// Usually cannotCalculateChanges after a long gap; start again from now.
		current, stateErr := s.stalwartEmailState(ctx, accountID)
		if stateErr != nil {
			return state, nil, 0, err
		}
		return current, nil, 0, nil
	}
	var changes struct {
		NewState string   `json:"newState"`
		Created  []string `json:"created"`
	}
	if err := json.Unmarshal(raw, &changes); err != nil {
		return state, nil, 0, err
	}
	if len(changes.Created) == 0 {
		return changes.NewState, nil, 0, nil
	}
	inbox, ok := inboxes[accountID]
	if !ok {
		roles, err := s.stalwartMailboxRoles(ctx, accountID)
		if err != nil {
			return state, nil, 0, err
		}
		inbox = roles["inbox"]
		inboxes[accountID] = inbox
	}
	emails, err := s.stalwartEmailSummaries(ctx, accountID, changes.Created)
	if err != nil {
		return state, nil, 0, err
	}
	messages := []mailNotifyMessage{}
	for _, email := range emails {
		if inbox == "" || !email.MailboxIDs[inbox] || email.Keywords["$seen"] {
			continue
		}
		from, fromName := "", ""
		if len(email.From) > 0 {
			from, fromName = email.From[0].Email, email.From[0].Name
		}
		messages = append(messages, mailNotifyMessage{
			ID: email.ID, From: from, FromName: fromName, Subject: email.Subject,
			Preview: clipDiscordText(email.Preview, 140), Date: email.ReceivedAt,
		})
	}
	sort.Slice(messages, func(i, j int) bool { return messages[i].Date.After(messages[j].Date) })
	total := len(messages)
	if len(messages) > mailNotifyPerMailbox {
		messages = messages[:mailNotifyPerMailbox]
	}
	return changes.NewState, messages, total, nil
}
