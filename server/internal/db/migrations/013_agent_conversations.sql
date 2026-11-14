ALTER TABLE jobs DROP CONSTRAINT jobs_status_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_status_check
    CHECK (status IN ('queued', 'running', 'paused', 'awaiting_input', 'succeeded', 'failed', 'cancelled', 'expired'));
ALTER TABLE jobs ADD COLUMN resumed_from_pause BOOLEAN NOT NULL DEFAULT FALSE;

DROP INDEX jobs_active_idx;
CREATE INDEX jobs_active_idx ON jobs (actor_id)
    WHERE status IN ('queued', 'running', 'paused', 'awaiting_input');
DROP INDEX jobs_input_expiry_idx;
CREATE INDEX jobs_input_expiry_idx ON jobs (input_expires_at)
    WHERE payload IS NOT NULL OR input IS NOT NULL OR status IN ('queued', 'running', 'paused', 'awaiting_input');

ALTER TABLE agent_policies DROP CONSTRAINT agent_policies_provider_check;
ALTER TABLE agent_policies ADD CONSTRAINT agent_policies_provider_check
    CHECK (provider IN ('', 'openai', 'ollama', 'mock', 'external'));
ALTER TABLE agent_runs DROP CONSTRAINT agent_runs_provider_check;
ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_provider_check
    CHECK (provider IN ('openai', 'ollama', 'mock', 'external'));

CREATE TABLE agent_conversations (
    job_id UUID PRIMARY KEY REFERENCES agent_runs(job_id) ON DELETE CASCADE,
    prompt TEXT NOT NULL CHECK (char_length(prompt) BETWEEN 1 AND 4000),
    answer TEXT CHECK (char_length(answer) BETWEEN 1 AND 1000),
    published BYTEA CHECK (octet_length(published) BETWEEN 1 AND 131072),
    expires_at TIMESTAMPTZ NOT NULL,
    cached_bytes INTEGER GENERATED ALWAYS AS (
        octet_length(prompt) + coalesce(octet_length(answer), 0) + coalesce(octet_length(published), 0)
    ) STORED
);

CREATE INDEX agent_conversations_expiry_idx ON agent_conversations (expires_at);

-- Active v12 runs still have bounded, validated inputs. Completed runs had
-- their input removed on success and have no conversation to recover.
INSERT INTO agent_conversations (job_id, prompt, answer, expires_at)
SELECT j.id, p.value->>'prompt', nullif(p.value->>'answer', ''), j.input_expires_at
FROM jobs j
JOIN agent_runs r ON r.job_id = j.id
CROSS JOIN LATERAL (SELECT convert_from(j.payload, 'UTF8')::jsonb AS value) p
WHERE j.kind = 'agent_run' AND j.status IN ('queued', 'running', 'awaiting_input')
    AND j.payload IS NOT NULL AND j.input_expires_at > statement_timestamp();
