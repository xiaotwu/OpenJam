CREATE TABLE agent_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
    personal_owner_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL,
    provider TEXT NOT NULL CHECK (provider IN ('', 'openai', 'ollama', 'mock')),
    model TEXT NOT NULL CHECK (length(model) <= 128),
    allow_board_context BOOLEAN NOT NULL DEFAULT FALSE,
    revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CHECK (num_nonnulls(organization_id, personal_owner_id) = 1),
    CHECK ((provider = '') = (model = '')),
    CHECK (NOT enabled OR provider <> '')
);

CREATE TABLE agent_runs (
    job_id UUID PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('openai', 'ollama', 'mock')),
    model TEXT NOT NULL CHECK (length(model) BETWEEN 1 AND 128),
    workflow TEXT NOT NULL CHECK (workflow IN ('workshop', 'flowchart', 'organize')),
    placement TEXT NOT NULL CHECK (placement IN ('new-page', 'current-page')),
    page_id TEXT NOT NULL,
    proposal_revision BIGINT CHECK (proposal_revision > 0),
    applied_epoch BIGINT CHECK (applied_epoch > 0),
    applied_seq BIGINT CHECK (applied_seq > 0),
    applied_client_id UUID,
    applied_at TIMESTAMPTZ,
    CHECK (num_nonnulls(proposal_revision, applied_epoch, applied_seq, applied_client_id, applied_at) IN (0, 5))
);
