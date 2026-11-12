# Project Branches and Sync

In a personal Project, choose **Import to Team** beside the project title. Select a Team workspace and a name for the new project. **Keep in Sync** links the two copies for later transfers. **Independent Branch** creates a Team copy that evolves on its own. Either mode imports saved Boards, Docs, Sheets, Slides, and their embedded images. Each Team file has its own URL and follows the Team project's access rules.

Open **Project Sync & Versions** and select a linked project. **Pull** brings incoming changes into the project you're viewing. **Commit & Push** sends its outgoing changes to the linked project and records the commit in both histories. You can give the commit a name.

When both sides change a file since their last sync, the file shows **Conflict**. Open either copy to review it. Choose **Use Linked Copy** and then **Pull**, or **Use Current Copy** and then **Commit & Push**. You can also leave a conflict unresolved while you transfer changes to other files. If someone edits after you preview the changes, OpenJam asks you to review the updated list before trying again.

Sync transfers saved file contents, names, new files, and archive state as a batch. A file deleted or moved out of one project is archived on the other side when that removal is synced. Embedded links keep their original destinations and continue to follow those destinations' permissions.

## Versions

On the **History** tab, enter a name and choose **Save Snapshot** to capture the project at that point. History also includes the initial Team copy, completed transfers, and the state before a restore. A Project Manager can preview the affected files and choose **Restore Project**. Existing files keep their URLs. A deleted file returns with a new URL, and files added after the snapshot move to Archive.

Project Managers can transfer files when they manage both linked projects. Managers and Editors can save snapshots for the project they can edit. Each side keeps its files and history when a member leaves or loses access. An import or restore applies file contents and embedded images. Comments, access grants, meetings, and other activity stay with their original project or file.

Project operations support up to 100 files and 32 MiB of saved document data per project, including archived files. Private image bytes live in object storage and are reused across snapshots. Back up PostgreSQL and object storage together.

## Quick Check

1. Open two local OpenJam instances that share PostgreSQL, Redis, and object storage. Import a personal project to a test Team in each mode.
2. Edit different files on the linked copies. Pull and then commit from one instance. Confirm the other instance sees the updates, while the independent copy retains its original contents.
3. Change the same file on both sides and check that the preview reports a conflict. Apply a resolution and confirm the previous version can still be recovered.
4. Save a snapshot, add a file, and restore the snapshot. Confirm the new file moves to Archive. Revoke the importing member's Project role and confirm their link disappears and earlier sync requests are rejected.
