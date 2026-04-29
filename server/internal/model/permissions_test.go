package model

import "testing"

func TestNormalizeRoomPermission(t *testing.T) {
	tests := []struct {
		name        string
		input       string
		want        RoomPermission
		wantOK      bool
		wantCanEdit bool
	}{
		{name: "view", input: " view ", want: RoomPermissionView, wantOK: true, wantCanEdit: false},
		{name: "comment", input: "COMMENT", want: RoomPermissionComment, wantOK: true, wantCanEdit: false},
		{name: "edit", input: "edit", want: RoomPermissionEdit, wantOK: true, wantCanEdit: true},
		{name: "invalid", input: "owner", wantOK: false, wantCanEdit: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := NormalizeRoomPermission(tt.input)
			if ok != tt.wantOK {
				t.Fatalf("NormalizeRoomPermission(%q) ok = %v, want %v", tt.input, ok, tt.wantOK)
			}
			if got != tt.want {
				t.Fatalf("NormalizeRoomPermission(%q) = %q, want %q", tt.input, got, tt.want)
			}
			if RoomPermissionAllowsEdit(got) != tt.wantCanEdit {
				t.Fatalf("RoomPermissionAllowsEdit(%q) = %v, want %v", got, RoomPermissionAllowsEdit(got), tt.wantCanEdit)
			}
		})
	}
}

func TestNormalizeSharePermission(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		want     SharePermission
		wantOK   bool
		wantRoom RoomPermission
		wantMaps bool
	}{
		{name: "restricted", input: "restricted", want: SharePermissionRestricted, wantOK: true, wantMaps: false},
		{name: "view link", input: "ANYONE-VIEW", want: SharePermissionAnyoneView, wantOK: true, wantRoom: RoomPermissionView, wantMaps: true},
		{name: "comment link", input: "anyone-comment", want: SharePermissionAnyoneComment, wantOK: true, wantRoom: RoomPermissionComment, wantMaps: true},
		{name: "edit link", input: "anyone-edit", want: SharePermissionAnyoneEdit, wantOK: true, wantRoom: RoomPermissionEdit, wantMaps: true},
		{name: "invalid", input: "public", wantOK: false, wantMaps: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := NormalizeSharePermission(tt.input)
			if ok != tt.wantOK {
				t.Fatalf("NormalizeSharePermission(%q) ok = %v, want %v", tt.input, ok, tt.wantOK)
			}
			if got != tt.want {
				t.Fatalf("NormalizeSharePermission(%q) = %q, want %q", tt.input, got, tt.want)
			}

			roomPermission, maps := SharePermissionToRoomPermission(got)
			if maps != tt.wantMaps {
				t.Fatalf("SharePermissionToRoomPermission(%q) maps = %v, want %v", got, maps, tt.wantMaps)
			}
			if roomPermission != tt.wantRoom {
				t.Fatalf("SharePermissionToRoomPermission(%q) = %q, want %q", got, roomPermission, tt.wantRoom)
			}
		})
	}
}
