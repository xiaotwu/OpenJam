# Meetings

Open a Team Overview or a personal or Team Project and choose the camera button. Use **Meet Now** to make a meeting available immediately or **Schedule** to set its start and end. In **Calendar**, the camera button opens scheduling for the selected date. The **Meetings** tab in Inbox shows open and upcoming meetings you can access, and opening an item clears its unread indicator.

Copy the meeting link from the lobby and send it to people who already have access. If they are signed out, OpenJam returns them to the meeting after sign-in. Scheduled meetings can last up to 24 hours and open 10 minutes before the start. A meeting stays open until the host ends it or until two hours after its scheduled end. **Meet Now** reserves one hour on the Calendar.

Join with your microphone and camera off. Use the call controls to turn them on or to share a browser tab, window, or screen. Choose **Leave** to disconnect your own session. The organizer or a scope manager can end the meeting for everyone or cancel it before it opens. Calendar retains ended meetings.

Project Managers and Editors can create Project meetings. Viewers and Commenters who can access the Project can join. Team members can create and join Team-wide meetings. Team owners and admins can end any Team-wide meeting. Personal Project access stays with its owner.

## Enable Media

The Docker Compose overlay starts a private LiveKit media server and allows up to 12 participants per meeting. Use a fresh secret of at least 32 bytes. The command below generates one for a local deployment. For persistent deployment, store the secret in the deployment environment and use it across upgrades.

```sh
export OPENJAM_MEETINGS_MEDIA_SECRET="$(openssl rand -hex 32)"
docker compose -f docker-compose.yml -f docker-compose.meetings.yml up --build --wait
```

On a single machine, open OpenJam at `http://localhost:8080`. The overlay publishes ICE TCP `7881` and UDP `7882` on loopback. For remote browsers, use HTTPS for OpenJam and set `OPENJAM_MEETINGS_MEDIA_IP` to an IP address reachable from those browsers. Set `OPENJAM_MEETINGS_MEDIA_BIND` to the appropriate interface, and allow the two ICE ports on that interface. Deploy TURN when clients need a relay to reach the media server. [LiveKit deployment guide](https://docs.livekit.io/transport/self-hosting/deployment/)

Forward WebSocket upgrades for `/ws/meetings/*` to OpenJam along with the app's other routes. Keep LiveKit's HTTP signaling and administrative port `7880` private to the OpenJam APIs. To use an existing private LiveKit deployment, set `OPENJAM_MEETINGS_MEDIA_URL`, `OPENJAM_MEETINGS_MEDIA_KEY`, and `OPENJAM_MEETINGS_MEDIA_SECRET` on each OpenJam API replica. All replicas for the same OpenJam database must use the same media service and key. Keep raw signaling query strings out of public proxy logs.

OpenJam checks the signed-in session and current scope access on every media connection and reconnect. The API also checks connected participants about every two seconds and removes them from the media server when their access or session ends. PostgreSQL stores the schedule and Inbox read state. Audio, video, and screen media are live streams.

## Quick Check

1. Check `/readyz` on each OpenJam API. On the private media service, check that LiveKit is running with `docker compose -f docker-compose.yml -f docker-compose.meetings.yml logs meeting-media`.
2. Open a meeting from two signed-in, authorized browser sessions. Turn on a microphone and camera and share a test tab. Confirm the other participant receives all three.
3. Interrupt one client's connection briefly. Confirm it reconnects and receives media again.
4. While that client is in a Project meeting, remove its Project access. Confirm it disappears from the call and its Inbox, and the link no longer opens for that account.

If the lobby loads but media does not connect, check the WebSocket upgrade path and the advertised ICE address and ports. For camera or screen capture errors, verify the page uses HTTPS or localhost and the browser has permission to capture the selected device or tab.
