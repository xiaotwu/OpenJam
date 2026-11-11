package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/project-wb/server/internal/agent"
	"github.com/project-wb/server/internal/middleware"
)

func RegisterAgentProfileRoutes(api *gin.RouterGroup) {
	const path = "/v2/me/agent-profile"
	api.GET(path, func(c *gin.Context) {
		c.Header("Cache-Control", "private, no-store")
		value, err := agent.ReadProfile(c.Request.Context(), middleware.GetUser(c).ID)
		writeAgentResult(c, http.StatusOK, value, err)
	})
	api.PUT(path, func(c *gin.Context) {
		c.Header("Cache-Control", "private, no-store")
		var profile agent.Profile
		if !bindAgentJSONWithLimit(c, &profile, agent.AgentProfileRequestLimit) {
			return
		}
		value, err := agent.SaveProfile(c.Request.Context(), middleware.GetUser(c).ID, profile)
		writeAgentResult(c, http.StatusOK, value, err)
	})
}

func getBoardAgentAttributions(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	boardID, ok := readDocumentBoardID(c)
	if !ok {
		return
	}
	result, err := agent.ReadAttributions(c.Request.Context(), boardID, middleware.GetUser(c).ID, c.Query("page"), c.Query("after"))
	writeAgentResult(c, http.StatusOK, result, err)
}
