import { useEffect, useReducer, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ConnectionState, DefaultReconnectPolicy, DisconnectReason, Room, RoomEvent, Track, type Participant } from 'livekit-client';
import { useI18n } from '../../i18n';
import { useTheme } from '../../lib/useTheme';
import { meetingEndpoint, meetingPath, meetingSignalURL, useWorkshopResource, workshopPath, writeWorkshop, type MeetingDetail } from '../../lib/workshop';
import WorkshopIcon, { type WorkshopIconName } from '../workshop/WorkshopIcon';
import './meetings.css';

const refreshEvents = [
  RoomEvent.ConnectionStateChanged, RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected,
  RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted,
  RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished, RoomEvent.ActiveSpeakersChanged,
  RoomEvent.AudioPlaybackStatusChanged,
] as const;

function disconnectMessage(reason?: DisconnectReason) {
  switch (reason) {
    case DisconnectReason.PARTICIPANT_REMOVED: return 'Your meeting access ended.';
    case DisconnectReason.ROOM_DELETED:
    case DisconnectReason.ROOM_CLOSED: return 'The meeting ended.';
    case DisconnectReason.DUPLICATE_IDENTITY: return 'This session joined from another tab.';
    default: return 'The connection dropped. Join again to reconnect.';
  }
}

function useMeetingCall(id: string, refresh: () => void) {
  const active = useRef<{ room: Room; detach: () => void }>(null);
  const [room, setRoom] = useState<Room>();
  const [error, setError] = useState('');
  const [, update] = useReducer((tick: number) => tick + 1, 0);

  useEffect(() => () => {
    const call = active.current;
    active.current = null;
    if (!call) return;
    call.detach();
    void call.room.disconnect().catch(() => undefined);
  }, []);

  function leave() {
    const call = active.current;
    if (!call) return;
    active.current = null;
    call.detach();
    setRoom(undefined);
    void call.room.disconnect().catch(() => undefined);
    refresh();
  }

  async function join() {
    if (active.current) return;
    setError('');
    const next = new Room({
      adaptiveStream: true, dynacast: true,
      publishDefaults: { stopMicTrackOnMute: true },
      reconnectPolicy: new DefaultReconnectPolicy([0, 500, 1_000, 2_000, 4_000, 8_000, 12_000]),
    });
    let connected = false;
    const sync = () => {
      if (active.current?.room !== next) return;
      if (next.state === ConnectionState.Connected) connected = true;
      update();
    };
    const onDisconnect = (reason?: DisconnectReason) => {
      if (active.current?.room !== next || !connected) return;
      setError(disconnectMessage(reason));
      leave();
    };
    next.on(RoomEvent.Disconnected, onDisconnect);
    for (const event of refreshEvents) next.on(event, sync);
    active.current = { room: next, detach: () => {
      next.off(RoomEvent.Disconnected, onDisconnect);
      for (const event of refreshEvents) next.off(event, sync);
    } };
    setRoom(next);
    try {
      await next.connect(meetingSignalURL(id), 'shiori');
    } catch {
      if (active.current?.room !== next) return;
      setError('Could not connect to the meeting. Try joining again.');
      leave();
    }
  }

  return { room, error, join, leave };
}

function publishedTrack(participant: Participant, source: Track.Source) {
  const publication = participant.getTrackPublication(source);
  return publication?.isMuted ? undefined : publication?.track;
}

function Video({ track }: { track: Track }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    track.attach(video);
    return () => { track.detach(video); };
  }, [track]);
  return <video ref={ref} autoPlay playsInline muted />;
}

function Audio({ track }: { track: Track }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const audio = ref.current;
    if (!audio) return;
    track.attach(audio);
    return () => { track.detach(audio); };
  }, [track]);
  return <audio ref={ref} autoPlay />;
}

function ParticipantTile({ participant, local, screen }: { participant: Participant; local?: boolean; screen?: Track }) {
  const name = participant.name || (local ? 'You' : 'Participant');
  const initials = name.trim().split(/\s+/u).slice(0, 2).map(word => Array.from(word)[0]).join('').toLocaleUpperCase();
  const camera = publishedTrack(participant, Track.Source.Camera);
  return <figure className="meeting-tile" data-speaking={!screen && participant.isSpeaking} data-screen={Boolean(screen)}
    data-local={Boolean(local)} data-video={Boolean(screen || camera)}>
    {screen || camera ? <Video track={(screen ?? camera)!} /> : <span className="meeting-avatar" aria-hidden="true">{initials}</span>}
    <figcaption>
      <span>{name}{local && participant.name ? ' (You)' : ''}{screen ? ' · Screen' : ''}</span>
      {!screen && !participant.isMicrophoneEnabled && <span aria-label="Muted"><WorkshopIcon name="microphoneOff" /></span>}
    </figcaption>
  </figure>;
}

function Call({ room, leave }: { room: Room; leave: () => void }) {
  const { formatNumber } = useI18n();
  const [changing, setChanging] = useState<Track.Source>();
  const [error, setError] = useState('');
  const local = room.localParticipant;
  const participants = [local, ...room.remoteParticipants.values()];
  const screens = participants.flatMap(participant => {
    const track = publishedTrack(participant, Track.Source.ScreenShare);
    return track ? [{ participant, track }] : [];
  });
  const audio = [...room.remoteParticipants.values()].flatMap(participant =>
    [...participant.audioTrackPublications.values()].flatMap(publication => publication.track && !publication.isMuted
      ? [{ id: publication.trackSid, track: publication.track }] : []));
  const ready = room.state === ConnectionState.Connected;
  const reconnecting = room.state === ConnectionState.Reconnecting || room.state === ConnectionState.SignalReconnecting;
  const controls: { icon: WorkshopIconName; name: string; source: Track.Source; pressed: boolean; toggle: () => Promise<unknown> }[] = [
    { icon: local.isMicrophoneEnabled ? 'microphone' : 'microphoneOff', name: 'Microphone', source: Track.Source.Microphone,
      pressed: local.isMicrophoneEnabled, toggle: () => local.setMicrophoneEnabled(!local.isMicrophoneEnabled) },
    { icon: local.isCameraEnabled ? 'camera' : 'cameraOff', name: 'Camera', source: Track.Source.Camera,
      pressed: local.isCameraEnabled, toggle: () => local.setCameraEnabled(!local.isCameraEnabled) },
    { icon: 'screenShare', name: 'Share Screen', source: Track.Source.ScreenShare,
      pressed: local.isScreenShareEnabled, toggle: () => local.setScreenShareEnabled(!local.isScreenShareEnabled, { audio: false }) },
  ];

  async function toggle(control: typeof controls[number]) {
    if (changing || !ready) return;
    setChanging(control.source);
    setError('');
    try {
      await control.toggle();
    } catch (failure) {
      const denied = failure instanceof DOMException && failure.name === 'NotAllowedError';
      setError(denied ? control.name + ' permission was declined.' : 'Could not change ' + control.name.toLocaleLowerCase() + '.');
    } finally {
      setChanging(undefined);
    }
  }

  return <section className="meeting-call" aria-label="Call">
    <p className="meeting-connection" role="status">
      <span aria-hidden="true" data-ready={ready} />
      {reconnecting ? 'Reconnecting…' : ready ? formatNumber(participants.length) + (participants.length === 1 ? ' participant' : ' participants') : 'Connecting…'}
    </p>
    <div className="meeting-stage" data-sharing={screens.length > 0}>
      {screens.length > 0 && <div className="meeting-screens" aria-label="Shared Screens">
        {screens.map(({ participant, track }) => <ParticipantTile key={track.sid} participant={participant} screen={track} local={participant === local} />)}
      </div>}
      <div className="meeting-people" aria-label="Participants" data-solo={participants.length === 1}>
        {participants.map(participant => <ParticipantTile key={participant === local ? 'self' : participant.identity}
          participant={participant} local={participant === local} />)}
      </div>
    </div>
    {audio.map(({ id, track }) => <Audio key={id} track={track} />)}
    <div className="meeting-call-footer">
      {error && <p className="meeting-error" role="alert">{error}</p>}
      {ready && !room.canPlaybackAudio && <button type="button" className="meeting-button" onClick={() => {
        void room.startAudio().catch(() => setError('Allow audio playback in your browser.'));
      }}><WorkshopIcon name="volume" />Enable Sound</button>}
      <div className="meeting-controls" role="group" aria-label="Call Controls">
        {controls.map(control => <button key={control.source} type="button" className="meeting-button meeting-icon"
          aria-label={control.name} aria-pressed={control.pressed} title={control.name}
          disabled={!ready || Boolean(changing)} onClick={() => void toggle(control)}><WorkshopIcon name={control.icon} /></button>)}
        <span className="meeting-control-divider" aria-hidden="true" />
        <button type="button" className="meeting-button meeting-leave" onClick={leave}><WorkshopIcon name="phoneOff" />Leave</button>
      </div>
    </div>
  </section>;
}

export default function MeetingRoom({ meetingId }: { meetingId: string }) {
  const location = useLocation();
  useTheme();
  const { formatDate } = useI18n();
  const endpoint = meetingEndpoint(meetingId);
  const [inCall, setInCall] = useState<MeetingDetail>();
  const result = useWorkshopResource<MeetingDetail>(workshopPath + endpoint, inCall ? 0 : 10_000);
  const [copy, setCopy] = useState<'copied' | 'manual'>();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [ending, setEnding] = useState(false);
  const [endError, setEndError] = useState('');
  const call = useMeetingCall(meetingId, () => {
    setInCall(undefined);
    setConfirmEnd(false);
    result.refresh();
  });
  const item = (call.room ? inCall : result.data)?.meeting;
  const back = typeof location.state?.workshop === 'string' && /^\/workplace(?:\?|$)/.test(location.state.workshop)
    ? location.state.workshop : '/workplace?view=inbox';
  const link = new URL(meetingPath(meetingId), window.location.origin).href;
  const supportsMedia = window.isSecureContext && typeof RTCPeerConnection !== 'undefined';

  const visibleId = result.data?.meeting.id;
  useEffect(() => {
    if (visibleId) void writeWorkshop(endpoint + '/read', 'PUT').catch(() => undefined);
  }, [endpoint, visibleId]);

  async function end() {
    setEnding(true);
    setEndError('');
    try {
      await writeWorkshop(endpoint + '/end', 'PUT');
      if (call.room) call.leave();
      else {
        setConfirmEnd(false);
        result.refresh();
      }
    } catch (failure) {
      setEndError(failure instanceof Error ? failure.message : 'Could not end the meeting.');
    } finally {
      setEnding(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopy('copied');
    } catch {
      setCopy('manual');
    }
  }

  return <main className="shiori-meeting">
    <header className="meeting-header">
      <Link to={back} className="meeting-button meeting-icon" aria-label="Back to Workshop" title="Back to Workshop"><WorkshopIcon name="back" /></Link>
      {item && <div className="meeting-heading">
        {call.room && <h1>{item.title}</h1>}
        <span><WorkshopIcon name="camera" />{item.scopeName}</span>
      </div>}
      {item && item.status !== 'ended' && <div className="meeting-header-actions">
        <button type="button" className="meeting-button meeting-icon" aria-label="Copy Meeting Link" title={copy === 'copied' ? 'Link Copied' : 'Copy Meeting Link'}
          onClick={() => void copyLink()}><WorkshopIcon name={copy === 'copied' ? 'check' : 'link'} /></button>
        {item.canEnd && <button type="button" className="meeting-button" disabled={ending} aria-expanded={confirmEnd}
          onClick={() => setConfirmEnd(!confirmEnd)}>{item.status === 'scheduled' ? 'Cancel Meeting' : 'End Meeting'}</button>}
      </div>}
    </header>
    {copy === 'copied' && <span className="sr-only" role="status">Meeting link copied.</span>}
    {item && copy === 'manual' && <label className="meeting-link">Meeting Link<input readOnly value={link} onFocus={event => event.currentTarget.select()} /></label>}
    {item && confirmEnd && item.status !== 'ended' && <div className="meeting-confirm">
      <p>{item.status === 'scheduled' ? 'Cancel this meeting?' : 'End the call for everyone?'}</p>
      <button type="button" className="meeting-button" onClick={() => setConfirmEnd(false)} disabled={ending}>Keep Meeting</button>
      <button type="button" className="meeting-button meeting-leave" onClick={() => void end()} disabled={ending}>
        {item.status === 'scheduled' ? 'Confirm Cancel' : 'End for Everyone'}
      </button>
      {endError && <p className="meeting-error" role="alert">{endError}</p>}
    </div>}
    {call.room ? <Call room={call.room} leave={call.leave} /> : <div className="meeting-lobby">
      <section className="meeting-lobby-card" aria-label="Meeting Lobby">
        <span className="meeting-lobby-icon"><WorkshopIcon name="camera" /></span>
        {item ? <>
          <h1>{item.title}</h1>
          <p><time dateTime={item.startsAt}>{formatDate(item.startsAt)}</time>{item.organizer && ' · ' + item.organizer}</p>
          {item.status === 'ended' ? <p role="status">This meeting has ended.</p>
            : item.status === 'scheduled' ? <p>Join from 10 minutes before the start.</p>
              : !result.data?.mediaEnabled ? <p>Meeting media is unavailable on this server.</p>
                : !supportsMedia ? <p>Open this link in a browser with WebRTC over HTTPS.</p>
                  : <><button type="button" className="meeting-button meeting-primary" onClick={() => {
                    setInCall(result.data);
                    void call.join();
                  }}><WorkshopIcon name="camera" />Join Meeting</button>
                  <p className="meeting-device-note">Microphone and camera start off.</p></>}
        </> : <>
          <h1>{result.loading ? 'Opening Meeting…' : 'Meeting Unavailable'}</h1>
          {result.error && <p role="alert">{result.error}</p>}
          {result.error && <button type="button" className="meeting-button" onClick={result.refresh}>Try Again</button>}
        </>}
        {call.error && <p className="meeting-error" role="alert">{call.error}</p>}
      </section>
    </div>}
  </main>;
}
