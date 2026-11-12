# Move a project to another OpenJam instance

A project archive (`.openjam-project.zip`) is a point-in-time copy. It contains Boards, Docs, Sheets and Slides, their current content and saved file versions, project snapshots, and the private images referenced by those revisions. Archived files keep their archived state. A file deleted before export can still be recovered from a project snapshot that contains it. Individual file versions already removed from the source, edit logs, and unsaved changes are outside the package.

1. Open a project and choose **Export Project Archive → Download** in the project header.
2. On the destination instance, open **Projects** or a Team **Overview** and choose **Restore Project Archive** in the toolbar.
3. Select the ZIP. Review the file, image, and history counts. Choose the workspace and project name. For a Team restore, expand **Map Members** to grant access to selected Team members.
4. Choose **Restore**. Open a file, follow a cross-file link, and check a saved version in **Project Sync & Versions** before retiring the original.

## Ownership and access

Only a Project Manager can export a package. Treat the downloaded ZIP like the private files it contains. The package does not carry accounts, sessions, share or invite credentials, direct file grants, Team membership, or a connection to the original project. Chat, calendar, meetings and external services stay on the source instance.

Restore always creates a new project in the selected personal or Team workspace. The target workspace owner retains their normal rights; a Team member restoring a project becomes its Project Manager. The source member list is included for reference. In a Team, the restorer may explicitly map each source member to an existing member of the target Team and choose a project role (Manager, Can Edit, Can Comment, or Can View). Unmapped people receive no grant. Personal restores have no member mapping. No accounts are matched by name or email, and the operation never adds anyone to a Team. Imported version author names are historical labels; they do not identify target accounts or grant access.

## How links move

Root-relative links and absolute links on the exporting instance's origin are recognized in text and link fields. Links to files included in the package point to the new file IDs on the destination. Page, document block, sheet cell, and slide anchors are preserved in both current and historical content. OpenJam file links outside the package keep pointing at the source instance. A file present only in an old snapshot has no live destination when the package is first restored. Links to other sites are kept as written. OpenJam share or invite credentials in recognized links are removed before export. After a restore, share the new files using the destination's normal sharing controls.

## Limits and troubleshooting

The first release accepts ZIPs up to 64 MiB and 96 MiB expanded. It supports up to 100 current files, 32 MiB of current document data, 12 MiB for one document revision, 1,500 total file versions and project snapshots, and 15,000 file entries across all snapshots. The exporter reports a limit instead of dropping history. Split oversized projects before migration. Legacy inline raster images are converted to private assets. An older board with an external image must have that image saved privately in OpenJam first; the exporter does not fetch remote images.

If a restore reports that Team members changed, check the destination roster and review the mapping. For a temporary storage or network error, retry from the same dialog; it reuses the restore request to avoid a duplicate project. A package with missing or damaged contents is rejected before a project becomes visible. Keep a copy of the source until you verify the restored project. Use deployment backups to recover accounts, permissions, and the whole instance.
