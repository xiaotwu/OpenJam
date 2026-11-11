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

**Recents** shows boards and documents you opened with your account. It hides files you can no longer access.

## Projects and Teams

Expand **Projects** for personal projects and Drafts. Open a project and choose **New → New Board** or **New → New Document**. **Shared With Me** includes files shared directly with you outside a project you can browse.

Expand **Teams** to create a Team or open one you joined. **Overview** lists the projects you can access and the Team roster. Owners and admins can create a named invitation in **Members**. Send the link privately to the invited address. It expires after seven days. The recipient signs in with that address and accepts the link.

In a Team project, open **Project Access** to grant roles to current Team members. A Manager can manage project access and boards. Editors can create and edit boards. Commenters can leave feedback, and Viewers can read. The Team owner can manage its projects. Team admins manage the roster, and their content access follows their project or board grants.

## Docs

Create a document in a personal or Team project with **New → New Document**. The editor saves blocks as you type. Select a block to edit its text, choose its style, or set its font. Enter splits a block and Shift+Enter inserts a line break inside it. Use **Preview** to read the rendered Markdown.

Editors can work in different blocks at the same time. If two edits change the same block, OpenJam keeps the queued edit for review and lets you download a copy. Use **Document History** to name the saved version and preview older text. The owner can restore a version, and editors can copy a saved version into personal Drafts. Sharing and block comments use the same permissions as boards.

From a project, choose **Import → Markdown or DOCX** to create a document from a file. In the editor, **Export Document** downloads the saved content as Markdown or Word. Word conversion supports paragraphs, headings, lists, bold, italics, links, quotes, and code. It uses the chosen block fonts when Word has them installed. OpenJam links in a Word export use the address of the exporting instance. Markdown carries the text and formatting syntax. Word tables are linearized to text, and images, comments, track changes markup, and page layout are outside the conversion. Imports accept up to 4 MiB, and a document supports up to 400 blocks and 1 MiB of text.

## Relationships and search

Open a Team’s Overview to see its relationship network alongside projects and members. Select a node to highlight its connections and open its source. To make a reference, choose **Copy Reference** in a file’s project menu and paste the relative link into a document or a text object on a board. The network displays references between accessible active files in the Team.

Use **Search Workshop** for projects, Team members, file names, and body text. In a Team, the search defaults to that Team and offers **All Workshop** as a scope. A content result opens its board page, object, or document block. The results and network reflect committed changes and current access. The index and file conversion run locally.

The selected object’s **Font Family** menu on a board and the document toolbar use the same bundled fonts. The rest of the interface uses IBM Plex Sans with system fallbacks for other scripts.

## Upgrading an existing directory

Back up PostgreSQL and referenced attachments before upgrading. Migration 015 adds Team membership and Project access to the existing directory. Existing team organizations appear under **Teams** with the same IDs and projects. Legacy boards without a project appear in their owner's personal Drafts. Existing board links, assets, direct grants, comments, and versions stay available under their original permissions. Migrations 016 and 017 index existing board text and add the Workshop data tables. Migration 018 adds the Docs resource type. Existing rooms are boards.

Removing a Project role removes access inherited from the project. An independent board share can still give access to that board. Removing a Team member or leaving a Team ends their access to its content, including direct grants held by that member. The Team keeps its files and version history. A new Team invitation restores Team membership with fresh Project grants.

### Verify a local upgrade

With two local OpenJam API instances connected to the same disposable PostgreSQL, Redis, and object storage, grant a test user view access to a Team project. Edit searchable text and a board reference through one instance. Confirm the other instance finds the new text, opens its source, and shows the updated reference. Then revoke the Project grant and Team membership in turn. Confirm the other instance hides the Project’s results and rejects requests for the former Team.

Run the same checks against a local test database named `openjam_cluster_test` from the `server` directory. Set `OPENJAM_CLUSTER_PRIMARY` and `OPENJAM_CLUSTER_SECONDARY` to the loopback API URLs, and `OPENJAM_CLUSTER_DATABASE_URL` to the disposable database URL.

```bash
OPENJAM_CLUSTER_WORKSHOP=1 OPENJAM_CLUSTER_DOCS=1 go test -race -count=1 -v ./tests -run '^Test(Workshop|Docs)Cluster$'
```
