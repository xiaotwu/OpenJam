ALTER TABLE jobs ADD COLUMN expired_lease_code VARCHAR(64) NOT NULL DEFAULT 'ATTEMPTS_EXHAUSTED'
    CHECK (expired_lease_code ~ '^[A-Z][A-Z0-9_]{0,63}$');
