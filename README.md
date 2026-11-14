<div align="center">
  <img src="app/public/icons/apple-touch.png" alt="" width="96" height="96">
  <h1>Shiori</h1>
  <p><strong>A self-hosted workspace for teams that plan, write, and work together.</strong></p>
  <p>
    <a href="#get-started">Get Started</a> ·
    <a href="docs/guide/getting-started.md">User Guide</a> ·
    <a href="docs/guide/docker.md">Deploy</a> ·
    <a href="https://github.com/xiaotwu/Shiori/issues">Report an Issue</a>
  </p>
</div>

Shiori brings boards, documents, spreadsheets, and presentations into team-owned Projects. A team can sketch a plan on a board, write the brief, track the budget, and present a decision from the same workspace. Search and file relationships respect the access each person has.

<p align="center">
  <img src="docs/public/images/shiori-character.png" alt="Shiori in a gray draped jacket, with pink-violet hair and three hairclips" width="20%" align="middle">
  <img src="docs/public/images/workshop-preview.png" alt="A Team Project in Shiori with a board, document, spreadsheet, and presentation" width="77%" align="middle">
</p>

Shiori’s mascot welcomes teams to the workspace and appears beside the feature previews.

## Workspace

- **Teams and Projects.** Give each project a home and grant access by role. Personal Projects stay under your account. Team Projects and their history stay with the team when a member leaves.
- **Work together in real time.** Collaborate on boards, write in Docs, edit cells in Sheets, and build decks in Slides. Use comments, private attachments, and named versions to review work and recover earlier content.
- **Find the source.** Search projects, people, file names, and content. Jump to the matching board object, document block, sheet cell, or slide. Team Overview shows relationships between accessible files.
- **Keep work in view.** Inbox brings team conversations, mentions, and upcoming items together. Calendar and Recents let you return to scheduled work and the files you opened.
- **Keep your data portable.** Bring in Markdown, DOCX, CSV, XLSX, and PPTX. Export supported formats or move an entire Project with its files, saved versions, and private images. [Format coverage](docs/guide/getting-started.md#docs) · [Project archives](docs/guide/project-archive.md)
- **Run it on your own infrastructure.** Docker Compose provisions the application, PostgreSQL, Redis, and SeaweedFS. Core collaboration, search, and file conversion run locally. [Deployment guide](docs/guide/docker.md)

## Get Started

For a local evaluation, install Docker with Compose and run this from the repository checkout.

~~~sh
docker compose up --build --wait
~~~

Open [localhost:8080](http://localhost:8080), create an account, and make a personal Project or a Team. Choose **New** inside a project to create a Board, Doc, Sheet, or Slide deck.

For a shared deployment, set a trusted HTTPS origin, configure the reverse proxy, and plan a verified backup before inviting users. Existing deployments should follow the upgrade and rollback steps in the operations guide. [Docker setup](docs/guide/docker.md) · [Operations and recovery](docs/guide/operations.md)

## Release Status

The first release targets Docker Compose for self-hosted teams. The frozen RC2 pilot candidate has passed local rehearsals. Pilot acceptance on the target host is pending. Meeting media requires separate setup and validation. Knowledge-base retrieval, the full deployment management console, and Kubernetes packaging are planned for later releases. [Pilot handoff](docs/guide/pilot-handoff.md) · [Meetings guide](docs/guide/meetings.md)

## Documentation

| Guide | What it covers |
| --- | --- |
| [Using Shiori](docs/guide/getting-started.md) | Teams, Projects, the editors, relationships, and search |
| [Project branches and sync](docs/guide/project-sync.md) | Link a personal Project to a Team, create a branch, or restore a snapshot |
| [Move a project](docs/guide/project-archive.md) | Export and recover project content on another instance |
| [Deploy with Docker](docs/guide/docker.md) | Services, storage, and deployment configuration |
| [Operations and recovery](docs/guide/operations.md) | Health checks, upgrades, backups, recovery, and troubleshooting |

## Contributing

The frontend uses React and TypeScript, with a Go API and worker. The [development setup](docs/guide/getting-started.md#development-setup) covers the local services and toolchain. Report reproducible issues with the revision, browser, and steps to reproduce, and leave credentials and private content out of reports.

Shiori is available under the [MIT License](LICENSE).
