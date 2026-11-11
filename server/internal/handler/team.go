package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/project-wb/server/internal/middleware"
	"github.com/project-wb/server/internal/model"
)

func registerTeamRoutes(directory *gin.RouterGroup, notify func(string)) {
	teams := directory.Group("/teams/:teamId")
	teams.GET("/members", listTeamMembers)
	teams.POST("/invitations", createTeamInvitation)
	teams.POST("/invitations/accept", acceptTeamInvitation)
	teams.PUT("/members/:memberId", changeTeamMember(false, notify))
	teams.DELETE("/members/:memberId", changeTeamMember(true, notify))

	projects := directory.Group("/projects/:projectId/members")
	projects.GET("", listProjectMembers)
	projects.PUT("/:memberId", changeProjectMember(false, notify))
	projects.DELETE("/:memberId", changeProjectMember(true, notify))
}

func listTeamMembers(c *gin.Context) {
	id, ok := readDirectoryID(c, c.Param("teamId"))
	if !ok {
		return
	}
	members, err := model.ListTeamMembers(c.Request.Context(), id, middleware.GetUser(c).ID)
	writeDirectoryResult(c, http.StatusOK, members, err)
}

func createTeamInvitation(c *gin.Context) {
	id, ok := readDirectoryID(c, c.Param("teamId"))
	if !ok {
		return
	}
	var request struct {
		Email string `json:"email"`
		Role  string `json:"role"`
	}
	if !readDirectoryBody(c, &request) {
		return
	}
	invitation, err := model.CreateTeamInvitation(c.Request.Context(), id, middleware.GetUser(c).ID, request.Email, request.Role)
	writeDirectoryResult(c, http.StatusCreated, invitation, err)
}

func acceptTeamInvitation(c *gin.Context) {
	id, ok := readDirectoryID(c, c.Param("teamId"))
	if !ok {
		return
	}
	var request struct {
		Token string `json:"token"`
	}
	if !readDirectoryBody(c, &request) {
		return
	}
	err := model.AcceptTeamInvitation(c.Request.Context(), id, middleware.GetUser(c).ID, request.Token)
	writeDirectoryResult(c, http.StatusOK, gin.H{"teamId": id}, err)
}

func changeTeamMember(remove bool, notify func(string)) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := readDirectoryID(c, c.Param("teamId"))
		if !ok {
			return
		}
		member, ok := readDirectoryID(c, c.Param("memberId"))
		if !ok {
			return
		}
		role, ok := readMemberRole(c, remove)
		if !ok {
			return
		}
		boards, err := model.ChangeTeamMember(c.Request.Context(), id, middleware.GetUser(c).ID, member, role)
		writeMembershipChange(c, boards, err, notify)
	}
}

func listProjectMembers(c *gin.Context) {
	id, ok := readDirectoryID(c, c.Param("projectId"))
	if !ok {
		return
	}
	members, err := model.ListProjectMembers(c.Request.Context(), id, middleware.GetUser(c).ID)
	writeDirectoryResult(c, http.StatusOK, members, err)
}

func changeProjectMember(remove bool, notify func(string)) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := readDirectoryID(c, c.Param("projectId"))
		if !ok {
			return
		}
		member, ok := readDirectoryID(c, c.Param("memberId"))
		if !ok {
			return
		}
		role, ok := readMemberRole(c, remove)
		if !ok {
			return
		}
		boards, err := model.ChangeProjectMember(c.Request.Context(), id, middleware.GetUser(c).ID, member, role)
		writeMembershipChange(c, boards, err, notify)
	}
}

func readMemberRole(c *gin.Context, remove bool) (string, bool) {
	if remove {
		return "", true
	}
	var request struct {
		Role string `json:"role"`
	}
	if !readDirectoryBody(c, &request) {
		return "", false
	}
	if request.Role == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Role is required"})
		return "", false
	}
	return request.Role, true
}

func writeMembershipChange(c *gin.Context, boards []string, err error, notify func(string)) {
	if err == nil && notify != nil {
		for _, board := range boards {
			notify(board)
		}
	}
	writeDirectoryResult(c, http.StatusOK, gin.H{"ok": true}, err)
}
