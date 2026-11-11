# Getting Started

The fastest way to run OpenJam is with Docker Compose.

## Quick Start (Docker)

```bash
git clone https://github.com/xiaotwu/openjam.git
cd openjam
docker compose up --build -d
```

Open [http://localhost:8080](http://localhost:8080) and create an account.

## Development Setup

For local development, you'll run the backend and frontend separately.

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (for database services)
- [Go](https://golang.org/dl/) 1.22+
- [Bun](https://bun.sh/) or [Node.js](https://nodejs.org/) 20+

### 1. Start dependency services

```bash
docker compose -f docker-compose.dev.yml up -d
```

This starts PostgreSQL, Redis, and MinIO.

### 2. Start the backend

```bash
cd server
cp .env.example .env
go run main.go
```

### 3. Start the frontend

::: code-group

```bash [Bun]
cd app
bun install
bun run dev
```

```bash [npm]
cd app
npm install
npm run dev
```

:::

### 4. Open the app

- Frontend: [http://localhost:5173](http://localhost:5173)
- Backend API: [http://localhost:8080](http://localhost:8080)
- MinIO Console: [http://localhost:9001](http://localhost:9001)

## Projects and Teams

Open Workplace after signing in. **My Projects** contains your personal projects and Drafts. Open a project and choose **New board**. **Shared with me** contains boards shared directly with you outside a project you can browse.

Choose **Teams** to create a Team or open one you joined. The Team page lists your visible projects and the Team roster. Owners and admins can create a named invitation in **Members**. Send the link privately to the invited address. It expires after seven days. The recipient signs in with that address and accepts the link.

In a Team project, open **Project access** to grant roles to current Team members. A Manager can manage project access and boards. Editors can create and edit boards. Commenters can leave feedback, and Viewers can read. The Team owner can manage its projects. Team admins manage the roster, and their content access follows their project or board grants.

## Upgrading an existing directory

Back up PostgreSQL and referenced attachments before upgrading. Restore the v14 backup if you need to run the older application. Migration 015 adds Team membership and Project access to the existing directory. Existing team organizations appear under **Teams** with the same IDs and projects. Legacy boards without a project appear in their owner's personal Drafts. Existing board links, assets, direct grants, comments and versions stay available under their original permissions.

Removing a Project role removes access inherited from the project. An independent board share can still give access to that board. Removing a Team member or leaving a Team ends access to its content, including direct grants held by that member. The Team keeps the boards and their version history. A new Team invitation restores Team membership with fresh Project grants.
