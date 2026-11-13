package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/xiaotwu/shiori/server/internal/middleware"
	"github.com/xiaotwu/shiori/server/internal/model"
)

type shareAccessResponse struct {
	Permission   string `json:"permission"`
	Source       string `json:"source"`
	Capabilities struct {
		CanRead    bool `json:"canRead"`
		CanComment bool `json:"canComment"`
		CanEdit    bool `json:"canEdit"`
		CanManage  bool `json:"canManage"`
		CanRestore bool `json:"canRestore"`
	} `json:"capabilities"`
}

type boardSharePermissionRequest struct {
	Permission    string `json:"permission"`
	ExpiresInDays int    `json:"expiresInDays"`
}

func RegisterBoardSharingRoutes(boards *gin.RouterGroup, notifyAccessChanged func(string)) {
	boards.GET("/access", getShareAccess)
	sharing := boards.Group("/sharing")
	sharing.GET("", getBoardSharing)
	sharing.POST("/invitations", createBoardInvitation)
	sharing.POST("/invitations/accept", acceptBoardCredential(true))
	sharing.DELETE("/invitations/:inviteId", revokeBoardInvitation)
	sharing.POST("/links", createBoardShareLink)
	sharing.POST("/links/redeem", acceptBoardCredential(false))
	sharing.DELETE("/links/:linkId", func(c *gin.Context) { revokeBoardShareLink(c, notifyAccessChanged) })
	sharing.PUT("/members/:memberId", func(c *gin.Context) { setBoardMemberRole(c, notifyAccessChanged) })
	sharing.DELETE("/members/:memberId", func(c *gin.Context) { removeBoardMember(c, notifyAccessChanged) })
	sharing.DELETE("/legacy-link", func(c *gin.Context) { disableLegacyBoardLink(c, notifyAccessChanged) })
}

func getShareAccess(c *gin.Context) {
	boardID, ok := readDocumentBoardID(c)
	if !ok {
		return
	}
	access, err := model.GetRoomAccess(c.Request.Context(), boardID, middleware.GetUser(c).ID)
	if err != nil {
		writeBoardSharingError(c, err)
		return
	}
	c.JSON(http.StatusOK, shareAccess(access))
}

func getBoardSharing(c *gin.Context) {
	boardID, ok := readDocumentBoardID(c)
	if !ok {
		return
	}
	sharing, err := model.GetBoardSharing(c.Request.Context(), boardID, middleware.GetUser(c).ID)
	if err != nil {
		writeBoardSharingError(c, err)
		return
	}
	c.JSON(http.StatusOK, sharing)
}

func createBoardInvitation(c *gin.Context) {
	boardID, ok := readDocumentBoardID(c)
	if !ok {
		return
	}
	var request struct {
		boardSharePermissionRequest
		Email string `json:"email"`
	}
	if !bindBoardShareJSON(c, &request) {
		return
	}
	permission, ok := model.NormalizeRoomPermission(request.Permission)
	if !ok {
		writeBoardSharingError(c, model.ErrInvalidRoomPermission)
		return
	}
	invite, token, err := model.CreateBoardInvitation(c.Request.Context(), boardID, middleware.GetUser(c).ID,
		request.Email, permission, shareLifetime(request.ExpiresInDays))
	if err != nil {
		writeBoardSharingError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"invitation": invite, "token": token})
}

func revokeBoardInvitation(c *gin.Context) {
	boardID, id, ok := boardShareRecordID(c, "inviteId")
	if !ok {
		return
	}
	if err := model.RevokeBoardInvitation(c.Request.Context(), boardID, middleware.GetUser(c).ID, id); err != nil {
		writeBoardSharingError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func createBoardShareLink(c *gin.Context) {
	boardID, ok := readDocumentBoardID(c)
	if !ok {
		return
	}
	var request boardSharePermissionRequest
	if !bindBoardShareJSON(c, &request) {
		return
	}
	permission, ok := model.NormalizeRoomPermission(request.Permission)
	if !ok {
		writeBoardSharingError(c, model.ErrInvalidSharePermission)
		return
	}
	link, token, err := model.CreateBoardShareLink(c.Request.Context(), boardID, middleware.GetUser(c).ID, permission, shareLifetime(request.ExpiresInDays))
	if err != nil {
		writeBoardSharingError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"link": link, "token": token})
}

func acceptBoardCredential(invitation bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		boardID, ok := readDocumentBoardID(c)
		if !ok {
			return
		}
		var request struct {
			Token string `json:"token"`
		}
		if !bindBoardShareJSON(c, &request) {
			return
		}
		accept := model.RedeemBoardShareLink
		if invitation {
			accept = model.AcceptBoardInvitation
		}
		access, err := accept(c.Request.Context(), boardID, middleware.GetUser(c).ID, request.Token)
		if err != nil {
			writeBoardSharingError(c, err)
			return
		}
		c.JSON(http.StatusOK, shareAccess(access))
	}
}

func revokeBoardShareLink(c *gin.Context, notify func(string)) {
	boardID, id, ok := boardShareRecordID(c, "linkId")
	if !ok {
		return
	}
	if err := model.RevokeBoardShareLink(c.Request.Context(), boardID, middleware.GetUser(c).ID, id); err != nil {
		writeBoardSharingError(c, err)
		return
	}
	if notify != nil {
		notify(boardID)
	}
	c.Status(http.StatusNoContent)
}

func setBoardMemberRole(c *gin.Context, notify func(string)) {
	boardID, id, ok := boardShareRecordID(c, "memberId")
	if !ok {
		return
	}
	var request boardSharePermissionRequest
	if !bindBoardShareJSON(c, &request) {
		return
	}
	permission, ok := model.NormalizeRoomPermission(request.Permission)
	if !ok {
		writeBoardSharingError(c, model.ErrInvalidRoomPermission)
		return
	}
	member, err := model.SetBoardMemberRole(c.Request.Context(), boardID, middleware.GetUser(c).ID, id, permission)
	if err != nil {
		writeBoardSharingError(c, err)
		return
	}
	if notify != nil {
		notify(boardID)
	}
	c.JSON(http.StatusOK, member)
}

func removeBoardMember(c *gin.Context, notify func(string)) {
	boardID, id, ok := boardShareRecordID(c, "memberId")
	if !ok {
		return
	}
	if err := model.RemoveRoomMember(c.Request.Context(), boardID, middleware.GetUser(c).ID, id); err != nil {
		writeBoardSharingError(c, err)
		return
	}
	if notify != nil {
		notify(boardID)
	}
	c.Status(http.StatusNoContent)
}

func disableLegacyBoardLink(c *gin.Context, notify func(string)) {
	boardID, ok := readDocumentBoardID(c)
	if !ok {
		return
	}
	if err := model.DisableLegacyBoardLink(c.Request.Context(), boardID, middleware.GetUser(c).ID); err != nil {
		writeBoardSharingError(c, err)
		return
	}
	if notify != nil {
		notify(boardID)
	}
	c.Status(http.StatusNoContent)
}

func boardShareRecordID(c *gin.Context, parameter string) (string, uuid.UUID, bool) {
	boardID, ok := readDocumentBoardID(c)
	if !ok {
		return "", uuid.Nil, false
	}
	id, err := uuid.Parse(c.Param(parameter))
	if err != nil || id == uuid.Nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_SHARE_REQUEST", "error": "Invalid sharing record ID"})
		return "", uuid.Nil, false
	}
	return boardID, id, true
}

func bindBoardShareJSON(c *gin.Context, request any) bool {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8*1024)
	if c.ShouldBindJSON(request) != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_SHARE_REQUEST", "error": "Invalid sharing request"})
		return false
	}
	return true
}

func shareLifetime(days int) int {
	if days == 0 {
		return 7
	}
	return days
}

func shareAccess(access *model.RoomAccess) shareAccessResponse {
	response := shareAccessResponse{Permission: string(access.Permission), Source: access.Source}
	if access.IsOwner {
		response.Permission = "owner"
	}
	response.Capabilities.CanRead = true
	response.Capabilities.CanEdit = access.IsOwner || access.Permission == model.RoomPermissionEdit
	response.Capabilities.CanComment = response.Capabilities.CanEdit || access.Permission == model.RoomPermissionComment
	response.Capabilities.CanManage = access.IsOwner
	response.Capabilities.CanRestore = access.IsOwner
	return response
}

func writeBoardSharingError(c *gin.Context, err error) {
	var status int
	var code string
	switch {
	case errors.Is(err, model.ErrNotRoomOwner):
		status, code = http.StatusForbidden, "OWNER_REQUIRED"
	case errors.Is(err, model.ErrInviteAccount):
		status, code = http.StatusForbidden, "INVITE_ACCOUNT_MISMATCH"
	case errors.Is(err, model.ErrShareCredentialGone):
		status, code = http.StatusGone, "SHARE_CREDENTIAL_UNAVAILABLE"
	case errors.Is(err, model.ErrShareRecordNotFound), errors.Is(err, model.ErrRoomMemberNotFound):
		status, code = http.StatusNotFound, "SHARE_RECORD_NOT_FOUND"
	case errors.Is(err, model.ErrAlreadyBoardMember):
		status, code = http.StatusConflict, "ALREADY_BOARD_MEMBER"
	case errors.Is(err, model.ErrTooManyActiveShares):
		status, code = http.StatusConflict, "SHARE_LIMIT_REACHED"
	case errors.Is(err, model.ErrInvalidShareLifetime), errors.Is(err, model.ErrInvalidInviteEmail),
		errors.Is(err, model.ErrInvalidRoomPermission), errors.Is(err, model.ErrInvalidSharePermission),
		errors.Is(err, model.ErrRoomMemberIsOwner):
		status, code = http.StatusBadRequest, "INVALID_SHARE_REQUEST"
	default:
		writeDocumentError(c, err)
		return
	}
	c.JSON(status, gin.H{"code": code, "error": err.Error()})
}
