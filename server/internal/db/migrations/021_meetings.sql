ALTER TABLE sessions ADD COLUMN meeting_identity UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE;

ALTER TABLE workshop_agenda
    DROP CONSTRAINT workshop_agenda_kind_check,
    ADD COLUMN meeting_created_at TIMESTAMPTZ,
    ADD COLUMN meeting_ended_at TIMESTAMPTZ,
    ADD CONSTRAINT workshop_agenda_kind_check CHECK (kind IN ('event', 'task', 'meeting')),
    ADD CONSTRAINT workshop_agenda_meeting_fields CHECK (
        (kind = 'meeting' AND (team_id IS NOT NULL OR project_id IS NOT NULL)
            AND meeting_created_at IS NOT NULL AND ends_at > starts_at)
        OR (kind <> 'meeting' AND meeting_created_at IS NULL AND meeting_ended_at IS NULL)
    );

CREATE INDEX workshop_meetings_current ON workshop_agenda (ends_at, meeting_created_at DESC)
    WHERE kind = 'meeting' AND meeting_ended_at IS NULL;

CREATE TABLE workshop_meeting_reads (
    meeting_id UUID NOT NULL REFERENCES workshop_agenda(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (meeting_id, user_id)
);

CREATE FUNCTION openjam_meeting_status(item workshop_agenda) RETURNS TEXT
LANGUAGE sql STABLE AS $$
    SELECT CASE
        WHEN item.meeting_ended_at IS NOT NULL OR item.ends_at + INTERVAL '2 hours' <= now() THEN 'ended'
        WHEN item.starts_at > now() + INTERVAL '10 minutes' THEN 'scheduled'
        ELSE 'open'
    END
$$;
