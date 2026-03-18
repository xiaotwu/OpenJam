# API Reference

OpenJam exposes a REST API for authentication, room management, and board operations.

## Authentication

### POST `/api/auth/register`
Create a new account.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "password123",
  "displayName": "Jane Doe"
}
```

**Response (200):**
```json
{
  "token": "abc123...",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "displayName": "Jane Doe",
    "avatarColor": "#3b82f6"
  }
}
```

### POST `/api/auth/login`
Sign in with existing account.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

### POST `/api/auth/logout`
End the current session.

## User

### GET `/api/me`
Get current user profile. Requires authentication.

### PUT `/api/me`
Update display name and avatar color.

**Request:**
```json
{
  "displayName": "New Name",
  "avatarColor": "#ef4444"
}
```

## Rooms

All room endpoints require authentication.

### POST `/api/rooms`
Create a new room.

**Request:**
```json
{ "name": "Sprint Planning" }
```

### GET `/api/rooms`
List rooms owned by the current user.

### GET `/api/rooms/:id`
Get room details.

### DELETE `/api/rooms/:id`
Delete a room (owner only).

## Board Data

### POST `/api/rooms/:id/save`
Save board state.

**Request:**
```json
{
  "name": "My Board",
  "elements": [...],
  "stamps": [...],
  "pages": [...]
}
```

### GET `/api/rooms/:id/load`
Load saved board state.

## Export

### POST `/api/rooms/:id/export/png`
Export board as PNG image.

### POST `/api/rooms/:id/export/json`
Export board as JSON.

### GET `/exports/:key`
Download an exported file.

## Health

### GET `/health`
Health check endpoint. Returns `{ "status": "ok" }`.

## WebSocket

### GET `/ws?token=<session_token>`
Upgrade to WebSocket connection. See [Collaboration](/guide/collaboration) for message format.
