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

## Workshop

Signing in opens **Inbox**. It lists Team discussions, direct conversations you started or received, and board comment mentions. Open a conversation to read or reply. Use the pin beside its subject to keep it at the top of your own list. Under **Account Settings → Appearance**, choose a count, a dot, or a hidden unread indicator. Text size and badge style are saved per account on this browser.

**Calendar** shows personal, Team, and Project events and tasks. Select a date and use the plus button to add an item. Personal items are private. A Team item is visible to current Team members, and a Project item follows Project access. Inbox links to items scheduled today and during the next seven days.

**Recents** shows boards you opened with your account. It hides boards you can no longer access.

## Projects and Teams

Expand **Projects** for personal projects and Drafts. Open a project and choose **New Board**. **Shared With Me** includes boards shared directly with you outside a project you can browse.

Expand **Teams** to create a Team or open one you joined. **Overview** lists the projects you can access and the Team roster. Owners and admins can create a named invitation in **Members**. Send the link privately to the invited address. It expires after seven days. The recipient signs in with that address and accepts the link.

In a Team project, open **Project Access** to grant roles to current Team members. A Manager can manage project access and boards. Editors can create and edit boards. Commenters can leave feedback, and Viewers can read. The Team owner can manage its projects. Team admins manage the roster, and their content access follows their project or board grants.

## Relationships and search

Open a Team and select **Relationships**. Select a member, project, or board to highlight its connections and open its source. To reference another board, choose **Copy Reference** in that board’s menu and paste the reference into a text object on the source board. The graph displays references between accessible active boards in the Team.

Use **Search Workshop** for projects, Team members, board names, and board text. In a Team, the search defaults to that Team and offers **All Workshop** as a scope. A content result opens the source page or object. Search covers saved canvas text, including supported widget text and unopened legacy boards. The results and graph reflect committed changes and current access. They run locally in PostgreSQL without an AI service.

The selected object’s **Font Family** menu applies bundled fonts to text objects, notes, and shapes. The rest of the interface uses IBM Plex Sans with system fallbacks for other scripts.

## Upgrading an existing directory

Back up PostgreSQL and referenced attachments before upgrading. Migration 015 adds Team membership and Project access to the existing directory. Existing team organizations appear under **Teams** with the same IDs and projects. Legacy boards without a project appear in their owner's personal Drafts. Existing board links, assets, direct grants, comments, and versions stay available under their original permissions. Migrations 016 and 017 index existing board text and add the Workshop data tables.

Removing a Project role removes access inherited from the project. An independent board share can still give access to that board. Removing a Team member or leaving a Team ends their access to its content, including direct grants held by that member. The Team keeps its boards and version history. A new Team invitation restores Team membership with fresh Project grants.

### Verify a local upgrade

With two local OpenJam API instances connected to the same disposable PostgreSQL, Redis, and object storage, grant a test user view access to a Team project. Edit searchable text and a board reference through one instance. Confirm the other instance finds the new text, opens its source, and shows the updated reference. Then revoke the Project grant and Team membership in turn. Confirm the other instance hides the Project’s results and rejects requests for the former Team.

Run the same checks against a local test database named `openjam_cluster_test` from the `server` directory. Set `OPENJAM_CLUSTER_PRIMARY` and `OPENJAM_CLUSTER_SECONDARY` to the loopback API URLs, and `OPENJAM_CLUSTER_DATABASE_URL` to the disposable database URL.

```bash
OPENJAM_CLUSTER_WORKSHOP=1 go test -race -count=1 -v ./tests -run '^TestWorkshopCluster$'
```
