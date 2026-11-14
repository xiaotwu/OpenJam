# FAQ

## General

### Is Shiori free?
Yes. Shiori is open-source and licensed under the MIT License.

### Can I use it commercially?
Yes. The MIT license allows commercial use.

### What browsers are supported?
Shiori works in modern browsers: Chrome, Firefox, Safari, Edge. WebSocket support is required.

## Deployment

### Do I need Redis?
No. Redis is optional. Without it, session caching and multi-server pub/sub are disabled, but single-server deployment works fine.

### Do I need MinIO?
The default deployment uses SeaweedFS. A compatible object store is required for private images and storage-backed features. See [Docker deployment](../guide/docker.md#object-storage).

### Can I use an external PostgreSQL?
Yes. Set the `DATABASE_URL` environment variable to your PostgreSQL connection string.

### Can I use AWS S3 instead of MinIO?
The MinIO client is S3-compatible. You can point `MINIO_ENDPOINT` to an S3-compatible endpoint and set `MINIO_USE_SSL=true`.

## Troubleshooting

### The app shows "Disconnected" in the status bar
- Check that the backend is running and accessible
- Verify CORS settings match your frontend URL
- Check browser console for WebSocket errors

### My changes aren't being saved

Check the editor’s sync indicator. When Shiori reports an offline or queued edit, reconnect and wait for **Saved**. If it reports a conflict, review or download the draft before discarding the edit. For a persistent server error, check `/readyz` and the server logs. [Saving and sync](../guide/collaboration.md#saving-and-sync)

### I can't see other users' cursors
- Both users must be in the same room (same URL)
- Check that WebSocket connections are established (status bar shows "Connected")

### Docker build fails
- Ensure Docker and Docker Compose are up to date
- Check available disk space
- Try `docker compose build --no-cache`

### How do I restore a deployment?

Use the [instance recovery procedure](../guide/operations.md#restore-an-instance) to restore PostgreSQL and object storage together into fresh stores.
