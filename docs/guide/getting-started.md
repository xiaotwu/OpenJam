# Getting Started

The fastest way to run Shiori is with Docker Compose.

## Quick Start (Docker)

```bash
git clone https://github.com/xiaotwu/Shiori.git shiori
cd shiori
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

This starts PostgreSQL, Redis, and SeaweedFS.

### 2. Start the backend

```bash
cd server
cp .env.example .env
go run .
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
- SeaweedFS S3 endpoint: [http://localhost:8333](http://localhost:8333)

## Workshop

Signing in opens **Inbox**. It lists Team discussions, direct conversations you started or received, and board comment mentions. Open a conversation to read or reply. Use the pin beside its subject to keep it at the top of your own list. Under **Account Settings → Appearance**, choose a count, a dot, or a hidden unread indicator. Text size and badge style are saved per account on this browser.

**Calendar** shows personal, Team, and Project events and tasks. Select a date and use the plus button to add an item. Personal items are private. A Team item is visible to current Team members, and a Project item follows Project access. Inbox links to items scheduled today and during the next seven days.

**Recents** shows boards and documents you opened with your account. It hides files you can no longer access.

## Projects and Teams

Expand **Projects** for personal projects and Drafts. Open a project and choose **New → New Board** or **New → New Document**. **Shared With Me** includes files shared directly with you outside a project you can browse.

Expand **Teams** to create a Team or open one you joined. **Overview** lists the projects you can access and the Team roster. Owners and admins can create a named invitation in **Members**. Send the link privately to the invited address. It expires after seven days. The recipient signs in with that address and accepts the link.

In a Team project, open **Project Access** to grant roles to current Team members. A Manager can manage project access and boards. Editors can create and edit boards. Commenters can leave feedback, and Viewers can read. The Team owner can manage its projects. Team admins manage the roster, and their content access follows their project or board grants.

Use **Import to Team** in a personal Project to create a linked Team copy or an independent branch. [Project Branches and Sync](./project-sync.md) explains transfers, conflict resolution, and snapshots.

Use [Project Archives](./project-archive.md) to move the contents and version history of a project between Shiori instances.

## Docs

Create a document in a personal or Team project with **New → New Document**. The editor saves blocks as you type. Select a block to edit its text, choose its style, or set its font. Enter splits a block and Shift+Enter inserts a line break inside it. Use **Preview** to read the rendered Markdown.

Editors can work in different blocks at the same time. If two edits change the same block, Shiori keeps the queued edit for review and lets you download a copy. Use **Document History** to name the saved version and preview older text. The owner can restore a version, and editors can copy a saved version into personal Drafts. Sharing and block comments use the same permissions as boards.

From a project, choose **Import → Markdown or DOCX** to create a document from a file. In the editor, **Export Document** downloads the saved content as Markdown or Word. Word conversion supports paragraphs, headings, lists, bold, italics, links, quotes, and code. It uses the chosen block fonts when Word has them installed. Shiori links in a Word export use the address of the exporting instance. Markdown carries the text and formatting syntax. Word tables are linearized to text, and images, comments, track changes markup, and page layout are outside the conversion. Imports accept up to 4 MiB, and a document supports up to 400 blocks and 1 MiB of text.

## Sheets

In a personal or Team project, choose **New → New Spreadsheet**. Select a cell, then type, press Enter, or double-click to edit it in the formula bar. Enter saves the edit and moves down. Escape cancels it. Use **Go to Cell** to jump to an address and **Copy Cell Link** to share that location with someone who already has access.

Start formulas with an equals sign. Use arithmetic, cell and range references, and `SUM`, `AVERAGE`, `MIN`, `MAX`, or `COUNT`. For example, `=SUM(B2:B8)` adds a range and `='April Plan'!B2*2` reads a cell on another worksheet. Prefix a value with an apostrophe to enter it as text. Formula results recalculate after sync. Editors can change different cells at the same time. If a cell has changed since you started editing it, Shiori keeps the attempted edit for review. Use **Spreadsheet History** to preview, name, copy, or restore versions according to your existing permissions.

Choose **Import → CSV or XLSX** in a project to create a spreadsheet. CSV imports UTF-8 data into one worksheet and exports the current worksheet’s displayed values. Formula-like CSV text receives a protective apostrophe on export. XLSX carries worksheets, cell values, and supported formulas. Unsupported formulas appear as errors in Shiori and export as text. Formatting, charts, merged cells, and date display formats are outside the conversion.

Workbooks support up to eight worksheets with addresses from A1 through AZ1000, 6,000 filled cells, 512 formulas, and 1 MiB of cell text. Each cell supports 1,024 bytes of text, and imports accept files up to 4 MiB.

## Slides

Choose **New → New Presentation** in a personal or Team project. Add slides with the plus button beside the thumbnails. Drag a thumbnail or use **Move Earlier** and **Move Later** to change its order. Insert text boxes and PNG or JPEG images from the toolbar. Drag objects to move them and use the corner handle to resize them. Double-click a text box to edit it. Click outside the box or press Ctrl+Enter (Command+Enter on a Mac) to save. **Presentation History** uses the same access and restore rules as other project files.

Choose **Present** to start from the selected slide. Use the arrow keys or on-screen controls to navigate, and press Escape to return to the editor. The slideshow fills the browser window when native full screen is unavailable.

Choose **Import → PowerPoint (.pptx)** in a project or **Export PowerPoint** in the editor. PPTX preserves slide order and aspect ratio, editable text boxes, basic text styling, and embedded PNG and JPEG images. Imported decks keep basic object position and size. Mixed formatting inside a text box, complex layouts, grouped shapes, notes, charts, and animations are outside the conversion. Import reports skipped objects and pictures. Uploads accept up to 32 MiB. Presentations support up to 60 slides, 100 objects per slide, 1,200 objects total, 1 MiB of text, and 24 MiB of embedded images.

## Meetings

Use the camera button in a Team or Project to schedule or start a meeting. Open your meeting links from Calendar or Inbox. The [Meetings guide](./meetings.md) covers access, call controls, and setup for self-hosted media.

## Relationships and search

Open a Team’s Overview to see its relationship network alongside projects and members. Select a node to highlight its connections and open its source. To make a reference, choose **Copy Reference** in a file’s project menu and paste the relative link into a spreadsheet cell, document, or a text object on a board. The network displays references between accessible active files in the Team.

Use **Search Workshop** for projects, Team members, file names, body text, and cell values. In a Team, the search defaults to that Team and offers **All Workshop** as a scope. A content result opens its board page, object, document block, spreadsheet cell, or slide. The results and network reflect committed changes and current access. The index and file conversion run locally.

The selected object’s **Font Family** menu on a board and the document toolbar use the same bundled fonts. The rest of the interface uses IBM Plex Sans with system fallbacks for other scripts.

## Upgrading an existing directory

Back up PostgreSQL and referenced attachments before upgrading. Migration 015 adds Team membership and Project access to the existing directory. Existing team organizations appear under **Teams** with the same IDs and projects. Legacy boards without a project appear in their owner's personal Drafts. Existing board links, assets, direct grants, comments, and versions stay available under their original permissions. Migrations 016 and 017 index existing board text and add the Workshop data tables. Migrations 018–020 add Docs, Sheets, and Slides to the directory and discovery tools.

Removing a Project role removes access inherited from the project. An independent board share can still give access to that board. Removing a Team member or leaving a Team ends their access to its content, including direct grants held by that member. The Team keeps its files and version history. A new Team invitation restores Team membership with fresh Project grants.

### Verify a local upgrade

With two local Shiori API instances connected to the same disposable PostgreSQL, Redis, and object storage, grant a test user view access to a Team project. Edit searchable text and a board reference through one instance. Confirm the other instance finds the new text, opens its source, and shows the updated reference. Then revoke the Project grant and Team membership in turn. Confirm the other instance hides the Project’s results and rejects requests for the former Team.

Run the same checks against a local test database named `shiori_cluster_test` from the `server` directory. Set `SHIORI_CLUSTER_PRIMARY` and `SHIORI_CLUSTER_SECONDARY` to the loopback API URLs, and `SHIORI_CLUSTER_DATABASE_URL` to the disposable database URL. Run with `-v` and confirm that the selected tests report `PASS`.

```bash
SHIORI_CLUSTER_WORKSHOP=1 SHIORI_CLUSTER_DOCS=1 SHIORI_CLUSTER_SHEETS=1 SHIORI_CLUSTER_SLIDES=1 \
  go test -race -count=1 -v ./tests -run '^Test(Workshop|Docs|Sheets|Slides)Cluster$'
```
