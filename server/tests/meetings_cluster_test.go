package tests

import (
	"net/http"
	"net/url"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/xiaotwu/shiori/server/internal/config"
	"github.com/xiaotwu/shiori/server/internal/model"
)

func TestMeetingsCluster(t *testing.T) {
	if config.Env("SHIORI_CLUSTER_MEETINGS") != "1" {
		t.Skip("requires two isolated local API replicas and a shared meeting media server")
	}
	a, b, dsn := config.Env("SHIORI_CLUSTER_PRIMARY"), config.Env("SHIORI_CLUSTER_SECONDARY"), config.Env("SHIORI_CLUSTER_DATABASE_URL")
	requireLocalCluster(t, a, b, dsn)
	client := &http.Client{Timeout: 8 * time.Second}
	host, _ := registerClusterUser(t, client, a, "Meeting host")
	member, email := registerClusterUser(t, client, b, "Meeting attendee")
	outsider, _ := registerClusterUser(t, client, b, "Meeting outsider")

	const v2 = "/api/v2"
	const workshop = v2 + "/workshop"
	team := clusterJSON[model.Organization](t, client, a, host, "POST", v2+"/organizations", map[string]string{"name": "Meeting Team"}, 201)
	teamPath := v2 + "/teams/" + team.ID.String()
	invite := clusterJSON[model.TeamInvitation](t, client, a, host, "POST", teamPath+"/invitations",
		map[string]string{"email": email, "role": "member"}, 201)
	clusterJSON[map[string]any](t, client, b, member, "POST", teamPath+"/invitations/accept", map[string]string{"token": invite.Token}, 200)
	memberID := clusterJSON[struct{ User model.User }](t, client, b, member, "GET", "/api/me", nil, 200).User.ID
	directory := clusterJSON[model.Directory](t, client, a, host, "GET", v2+"/directory", nil, 200)
	workspace := func(org uuid.UUID) model.Workspace {
		t.Helper()
		for _, space := range directory.Workspaces {
			if space.OrganizationID == org && space.IsDefault {
				return space
			}
		}
		t.Fatal("missing default workspace")
		return model.Workspace{}
	}
	addProject := func(org uuid.UUID, name string) model.Project {
		t.Helper()
		return clusterJSON[model.Project](t, client, a, host, "POST", v2+"/workspaces/"+workspace(org).ID.String()+"/projects",
			map[string]string{"name": name}, 201)
	}
	teamProject := addProject(team.ID, "Team Project")
	var personalOrg uuid.UUID
	for _, org := range directory.Organizations {
		if org.Kind == "personal" {
			personalOrg = org.ID
		}
	}
	personalProject := addProject(personalOrg, "Personal Project")

	type detail struct {
		Meeting      model.Meeting
		MediaEnabled bool
	}
	route := func(id uuid.UUID) string { return workshop + "/meetings/" + id.String() }
	create := func(base, token string, id uuid.UUID, input model.MeetingDraft, status int) {
		t.Helper()
		clusterJSON[map[string]any](t, client, base, token, "PUT", route(id), input, status)
	}
	read := func(base, token string, id uuid.UUID, status int) detail {
		t.Helper()
		return clusterJSON[detail](t, client, base, token, "GET", route(id), nil, status)
	}
	validate := func(base, token string, id uuid.UUID, status int) {
		t.Helper()
		res := clusterRequest(client, base, token, "GET", "/ws/meetings/"+id.String()+"/rtc/validate", nil)
		if res.err != nil || res.status != status {
			t.Fatalf("media admission returned HTTP %d, want %d: %s %v", res.status, status, res.body, res.err)
		}
	}
	start := time.Now().UTC().Add(time.Hour).Truncate(time.Second)
	end := start.Add(30 * time.Minute)
	future := uuid.New()
	create(a, host, future, model.MeetingDraft{TeamID: &team.ID, Title: "Upcoming Team Meeting", StartsAt: &start, EndsAt: &end}, 200)
	if result := read(b, member, future, 200); result.Meeting.Status != "scheduled" || result.Meeting.CanEnd || !result.MediaEnabled {
		t.Fatalf("unexpected scheduled meeting for attendee: %+v", result)
	}
	validate(b, member, future, 403)
	validate(b, "", future, 401)

	personal := uuid.New()
	create(b, host, personal, model.MeetingDraft{ProjectID: &personalProject.ID, Title: "Personal Room"}, 200)
	validate(a, host, personal, 200)
	read(a, member, personal, 404)
	validate(a, member, personal, 403)

	project := uuid.New()
	draft := model.MeetingDraft{ProjectID: &teamProject.ID, Title: "Team Project Room"}
	create(a, host, project, draft, 200)
	create(b, host, project, draft, 200)
	changed := draft
	changed.Title = "A conflicting retry"
	create(b, host, project, changed, 409)
	read(b, member, project, 404)
	read(b, outsider, project, 404)
	validate(b, outsider, project, 403)
	grant := v2 + "/projects/" + teamProject.ID.String() + "/members/" + memberID.String()
	clusterJSON[map[string]any](t, client, a, host, "PUT", grant, map[string]string{"role": "view"}, 200)
	if result := read(b, member, project, 200); result.Meeting.Status != "open" || result.Meeting.CanEnd {
		t.Fatalf("unexpected instant meeting for viewer: %+v", result)
	}
	create(b, member, uuid.New(), draft, 403)
	validate(b, member, project, 200)
	clusterJSON[map[string]any](t, client, b, member, "PUT", route(project)+"/end", nil, 403)
	clusterJSON[map[string]any](t, client, a, host, "DELETE", workshop+"/agenda/"+project.String()+"?revision=1", nil, 404)

	window := url.Values{"from": {start.Add(-2 * time.Hour).Format(time.RFC3339)}, "to": {end.Add(time.Hour).Format(time.RFC3339)}}
	agenda := func() []model.AgendaItem {
		return clusterJSON[struct{ Items []model.AgendaItem }](t, client, b, member, "GET", workshop+"/agenda?"+window.Encode(), nil, 200).Items
	}
	inbox := func() model.WorkshopInbox {
		return clusterJSON[model.WorkshopInbox](t, client, b, member, "GET", workshop+"/inbox", nil, 200)
	}
	if items := agenda(); !slices.ContainsFunc(items, func(item model.AgendaItem) bool {
		return item.ID == project && item.Kind == "meeting" && item.MeetingStatus == "open" && !item.Editable
	}) {
		t.Fatalf("Calendar did not include the visible Project meeting: %+v", items)
	}
	if notices := inbox(); notices.UnreadMeetings != 2 || notices.Unread != 2 || len(notices.Meetings) != 2 {
		t.Fatalf("Inbox did not include both visible meetings: %+v", notices)
	}
	clusterJSON[map[string]any](t, client, a, member, "PUT", route(project)+"/read", nil, 200)
	if notices := inbox(); notices.UnreadMeetings != 1 || notices.Unread != 1 {
		t.Fatalf("reading a meeting did not clear its unread status: %+v", notices)
	}

	clusterJSON[map[string]any](t, client, a, host, "DELETE", grant, nil, 200)
	read(b, member, project, 404)
	validate(b, member, project, 403)
	if items := agenda(); len(items) != 1 || items[0].ID != future {
		t.Fatalf("Calendar retained revoked Project meeting: %+v", items)
	}
	if notices := inbox(); len(notices.Meetings) != 1 || notices.Meetings[0].ID != future {
		t.Fatalf("Inbox retained revoked Project meeting: %+v", notices)
	}
	clusterJSON[map[string]any](t, client, a, host, "DELETE", teamPath+"/members/"+memberID.String(), nil, 200)
	read(b, member, future, 404)
	clusterJSON[map[string]any](t, client, a, host, "PUT", route(project)+"/end", nil, 200)
	if result := read(b, host, project, 200); result.Meeting.Status != "ended" {
		t.Fatalf("meeting did not end across replicas: %+v", result)
	}
	validate(b, host, project, 403)
}
