/** Worker bindings and configuration. */

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Absent in `vitest`/unit contexts and when Queues are not provisioned. */
  PIPELINE?: Queue<PipelineMessage>;

  APP_NAME: string;
  APP_ENV: string;
  PUBLIC_BASE_URL: string;

  MAIL_FROM: string;
  MAIL_REPLY_TO: string;
  /** Secret. When unset, mail is logged to the console and stored in the outbox. */
  RESEND_API_KEY?: string;
  /** Cc'd on every report email. A fixed operational address, not per-candidate. */
  REPORT_CC_EMAIL?: string;

  /** Seeded into admin_users on first boot if the table is empty. */
  ADMIN_EMAIL: string;
  ADMIN_PASSWORD: string;

  /** Secrets. The wrangler.jsonc values are development placeholders only. */
  LINK_TOKEN_SECRET: string;
  JWT_SECRET: string;
}

export type PipelineMessage =
  /**
   * `reportToken` is minted at submit time so the candidate can be given a
   * working report URL immediately; the pipeline stores only its hash.
   */
  | { type: 'score_and_deliver'; responseId: string; reportToken: string }
  | { type: 'send_invite'; batchItemId: string }
  /**
   * One leader's peer-feedback report. A fresh token is minted per send, since
   * member report tokens are stored only as hashes and are not recoverable —
   * so a resend is a re-issue, and the previous link stops working.
   */
  | { type: 'send_cohort_report'; cohortReportId: string; reportToken: string };

/** Base URL for links in mail, preferring the request origin in development. */
export function baseUrl(env: Env, req?: Request): string {
  if (env.PUBLIC_BASE_URL) return env.PUBLIC_BASE_URL.replace(/\/+$/, '');
  if (req) return new URL(req.url).origin;
  return '';
}
