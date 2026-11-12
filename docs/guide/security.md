# Authentication & Security

OpenJam implements session-based authentication with several security measures.

## Authentication Flow

1. User registers with email, password, and display name
2. Password is hashed with **bcrypt** (default cost)
3. A 32-byte cryptographically random session token is generated
4. Token is stored in PostgreSQL with an expiration (7 days)
5. Token is returned to the client and stored in localStorage
6. Subsequent requests include the token in the `Authorization: Bearer` header

## Session Management

- Sessions are stored in PostgreSQL with automatic expiration
- Redis caching (when available) reduces database lookups
- Session cache TTL: 15 minutes (refreshed on access)
- Expired sessions are cleaned up hourly by a background routine
- Logout invalidates the session immediately

## WebSocket Authentication

WebSocket connections are authenticated before upgrade:
1. The browser sends the HTTP-only session cookie on the WebSocket handshake
2. Server validates the token against the session store
3. Only authenticated connections are upgraded to WebSocket

## Room Access Control

- Rooms are owned by the user who created them
- Room list shows owned rooms and rooms where the current user is an invited member
- Owners can invite registered OpenJam users by email with `view`, `comment`, or `edit` permission
- Owners can configure board-link permissions: `restricted`, `anyone-view`, `anyone-comment`, or `anyone-edit`
- Public link permissions apply to authenticated users who have the board URL; unauthenticated viewers still need to sign in first
- Room load, export, and WebSocket join flows allow owners, invited members, and authenticated link viewers
- Room save and WebSocket operation flows require owner or edit permission
- Room rename through the room API and deletion remain owner-only

## Security Headers

- CORS is configured per environment (restrict `CORS_ORIGINS` in production)
- Credentials are included in CORS configuration
- Session cookies are set with `HttpOnly` flag

## Best Practices for Production

1. **Use HTTPS** with a reverse proxy and set `ENVIRONMENT=production` for secure session cookies.
2. **Restrict CORS origins** by setting `CORS_ORIGINS` to the deployment's HTTPS origin.
3. **Set unique credentials** for PostgreSQL and object storage.
4. **Use Redis** for session caching and multi-server collaboration.
5. **Protect instance backups** because they contain account data and active sessions. Follow the [operations guide](./operations.md).
