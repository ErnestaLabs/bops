-- Application action records; Trigger.dev remains the orchestration engine.
-- Apply explicitly to a customer-owned database. Never to Trigger's internal DB.
BEGIN;
CREATE TABLE IF NOT EXISTS ernesta_workflow_actions (
  action_key text PRIMARY KEY CHECK (action_key ~ '^[a-f0-9]{64}$'),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('SUBMITTING','SUBMITTED','OUTCOME_UNKNOWN')),
  remote_id text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ernesta_workflow_events (
  event_id bigserial PRIMARY KEY, action_key text NOT NULL REFERENCES ernesta_workflow_actions(action_key),
  event_type text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ernesta_workflow_events_action_idx ON ernesta_workflow_events(action_key,event_id);
COMMIT;
