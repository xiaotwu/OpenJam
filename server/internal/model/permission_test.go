package model

import "testing"

// The permission model is the security boundary for every shared board in a
// team deployment. These tests pin the exact mapping between share-link
// permissions, member permissions and the edit gate so a future refactor
// cannot silently widen access.

func TestNormalizeRoomPermission(t *testing.T) {
	cases := []struct {
		in    string
		want  RoomPermission
		valid bool
	}{
		{"view", RoomPermissionView, true},
		{"comment", RoomPermissionComment, true},
		{"edit", RoomPermissionEdit, true},
		{"  EDIT ", RoomPermissionEdit, true}, // trims + case-insensitive
		{"View", RoomPermissionView, true},
		{"owner", "", false},     // owner is not a member permission
		{"admin", "", false},     // no admin role exists
		{"", "", false},          // empty rejected
		{"* */ DROP", "", false}, // garbage rejected
	}
	for _, c := range cases {
		got, ok := NormalizeRoomPermission(c.in)
		if ok != c.valid || got != c.want {
			t.Errorf("NormalizeRoomPermission(%q) = (%q,%v), want (%q,%v)", c.in, got, ok, c.want, c.valid)
		}
	}
}

func TestNormalizeSharePermission(t *testing.T) {
	cases := []struct {
		in    string
		want  SharePermission
		valid bool
	}{
		{"restricted", SharePermissionRestricted, true},
		{"anyone-view", SharePermissionAnyoneView, true},
		{"anyone-comment", SharePermissionAnyoneComment, true},
		{"anyone-edit", SharePermissionAnyoneEdit, true},
		{"ANYONE-EDIT", SharePermissionAnyoneEdit, true},
		{"public", "", false},
		{"anyone", "", false},
		{"", "", false},
	}
	for _, c := range cases {
		got, ok := NormalizeSharePermission(c.in)
		if ok != c.valid || got != c.want {
			t.Errorf("NormalizeSharePermission(%q) = (%q,%v), want (%q,%v)", c.in, got, ok, c.want, c.valid)
		}
	}
}

func TestSharePermissionToRoomPermission(t *testing.T) {
	// 'restricted' must NOT map to any room permission — a restricted link
	// grants no implicit access. The anonymous "anyone-*" tiers map onto the
	// equivalent member permission.
	if _, ok := SharePermissionToRoomPermission(SharePermissionRestricted); ok {
		t.Error("restricted link must not grant an implicit room permission")
	}
	mapping := map[SharePermission]RoomPermission{
		SharePermissionAnyoneView:    RoomPermissionView,
		SharePermissionAnyoneComment: RoomPermissionComment,
		SharePermissionAnyoneEdit:    RoomPermissionEdit,
	}
	for share, want := range mapping {
		got, ok := SharePermissionToRoomPermission(share)
		if !ok || got != want {
			t.Errorf("SharePermissionToRoomPermission(%q) = (%q,%v), want (%q,true)", share, got, ok, want)
		}
	}
}

func TestRoomPermissionAllowsEdit(t *testing.T) {
	if !RoomPermissionAllowsEdit(RoomPermissionEdit) {
		t.Error("edit permission must allow editing")
	}
	for _, p := range []RoomPermission{RoomPermissionView, RoomPermissionComment, ""} {
		if RoomPermissionAllowsEdit(p) {
			t.Errorf("permission %q must NOT allow editing", p)
		}
	}
}

// TestCommentCannotWriteThroughEditGate guards the specific regression class
// where a "comment" collaborator is accidentally granted write access to board
// elements (comments are metadata, not board mutations).
func TestCommentCannotWriteThroughEditGate(t *testing.T) {
	access := &RoomAccess{IsOwner: false, Permission: RoomPermissionComment}
	if access.IsOwner || RoomPermissionAllowsEdit(access.Permission) {
		t.Error("a comment-only member must fail the edit gate")
	}
}
