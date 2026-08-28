import { logger, stripSensitiveFields } from "./logger";

export interface ErrorReport {
  method: string;
  path: string;
  requestId: string;
  status: number;
}

const ERROR_REPORTING_WEBHOOK = process.env.ERROR_REPORTING_WEBHOOK;

/**
 * Reports an unexpected 500 error to an external error sink (e.g., Sentry, webhook).
 * Only active when ERROR_REPORTING_WEBHOOK is configured. No PII is sent.
 */
export async function reportError(report: ErrorReport): Promise<void> {
  if (!ERROR_REPORTING_WEBHOOK) {
    return;
  }

  try {
    const response = await fetch(ERROR_REPORTING_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        timestamp: new Date().toISOString(),
        method: report.method,
        path: report.path,
        requestId: report.requestId,
        status: report.status,
        // Include environment context (no secrets)
        environment: process.env.NODE_ENV ?? "unknown",
      }),
      signal: AbortSignal.timeout(5000), // 5s timeout to avoid hanging
    });

    if (!response.ok) {
      logger.warn(
        stripSensitiveFields({
          event: "error_reporting_rejected",
          requestId: report.requestId,
          status: response.status,
        }),
      );
    } else {
      logger.info(
        stripSensitiveFields({
          event: "error_reported",
          requestId: report.requestId,
        }),
      );
    }
  } catch (err) {
    logger.error(
      stripSensitiveFields({
        event: "error_reporting_failed",
        requestId: report.requestId,
        error: (err as Error).message,
      }),
    );
  }
}
