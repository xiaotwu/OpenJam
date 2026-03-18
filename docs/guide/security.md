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
1. Client sends the session token as a query parameter
2. Server validates the token against the session store
3. Only authenticated connections are upgraded to WebSocket

## Room Access Control

- Rooms are owned by the user who created them
- Room list only shows rooms owned by the current user
- Room deletion is restricted to the owner

## Security Headers

- CORS is configured per environment (restrict `CORS_ORIGINS` in production)
- Credentials are included in CORS configuration
- Session cookies are set with `HttpOnly` flag

## Best Practices for Production

1. **Change `SESSION_SECRET`** - Generate a random string: `openssl rand -hex 32`
2. **Restrict CORS origins** - Set `CORS_ORIGINS` to your actual domain(s)
3. **Use HTTPS** - Deploy behind a reverse proxy (nginx, Caddy) with TLS
4. **Change default credentials** - Update MinIO and PostgreSQL passwords
5. **Enable Redis** - For session caching and multi-server support
