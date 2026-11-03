/** Inject a pg Pool. No task parameters, credentials or model prompts are logged. */
import { WorkflowError } from './contracts.mjs';
const hash = v => { if (typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v)) throw new WorkflowError('invalid_action_identity'); };
export function postgresLedger(pool) {
  if (!pool?.connect) throw new WorkflowError('ledger_required');
  async function transaction(work) {
    let db;
    try { db = await pool.connect(); await db.query('BEGIN'); const value = await work(db); await db.query('COMMIT'); return value; }
    catch (e) { if (db) await db.query('ROLLBACK').catch(() => {}); throw e instanceof WorkflowError ? e : new WorkflowError('ledger_unavailable'); }
    finally { db?.release(); }
  }
  return {
    reserve(actionKey, requestHash) {
      hash(actionKey); hash(requestHash);
      return transaction(async db => {
        const inserted = await db.query("INSERT INTO ernesta_workflow_actions(action_key,request_hash,status) VALUES($1,$2,'SUBMITTING') ON CONFLICT DO NOTHING RETURNING action_key", [actionKey,requestHash]);
        const {rows:[row]} = await db.query('SELECT request_hash,remote_id FROM ernesta_workflow_actions WHERE action_key=$1 FOR UPDATE', [actionKey]);
        if (!row || row.request_hash !== requestHash) throw new WorkflowError('action_key_payload_conflict');
        if (inserted.rowCount) await db.query("INSERT INTO ernesta_workflow_events(action_key,event_type) VALUES($1,'SUBMISSION_RESERVED')",[actionKey]);
        return { created: !!inserted.rowCount, requestHash: row.request_hash, remoteId: row.remote_id };
      });
    },
    submitted(actionKey, requestHash, remoteId) {
      hash(actionKey); hash(requestHash);
      if (typeof remoteId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(remoteId)) throw new WorkflowError('invalid_remote_id');
      return transaction(async db => {
        const r = await db.query("UPDATE ernesta_workflow_actions SET status='SUBMITTED',remote_id=$3,updated_at=now() WHERE action_key=$1 AND request_hash=$2 AND status='SUBMITTING' AND remote_id IS NULL RETURNING action_key", [actionKey,requestHash,remoteId]);
        if (r.rowCount !== 1) throw new WorkflowError('ledger_state_conflict');
        await db.query("INSERT INTO ernesta_workflow_events(action_key,event_type) VALUES($1,'REMOTE_ID_RECORDED')",[actionKey]);
      });
    },
    unknown(actionKey, requestHash) {
      hash(actionKey); hash(requestHash);
      return transaction(async db => {
        await db.query("UPDATE ernesta_workflow_actions SET status='OUTCOME_UNKNOWN',updated_at=now() WHERE action_key=$1 AND request_hash=$2 AND remote_id IS NULL", [actionKey,requestHash]);
        await db.query("INSERT INTO ernesta_workflow_events(action_key,event_type) VALUES($1,'RECONCILIATION_REQUIRED')", [actionKey]);
      });
    },
    /** Record an action that reconciliation proved already happened. Refuses to
     * invent a success for an absent action, and closes one action only once. */
    reconcile(actionKey, requestHash, remoteId) {
      hash(actionKey); hash(requestHash);
      if (typeof remoteId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(remoteId)) throw new WorkflowError('invalid_remote_id');
      return transaction(async db => {
        const r = await db.query("UPDATE ernesta_workflow_actions SET status='SUBMITTED',remote_id=$3,updated_at=now() WHERE action_key=$1 AND request_hash=$2 AND status='OUTCOME_UNKNOWN' AND remote_id IS NULL RETURNING action_key", [actionKey,requestHash,remoteId]);
        if (r.rowCount !== 1) throw new WorkflowError('not_reconcilable');
        await db.query("INSERT INTO ernesta_workflow_events(action_key,event_type) VALUES($1,'RECONCILED')", [actionKey]);
        return { remoteId };
      });
    },
  };
}
