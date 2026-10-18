type LogLevel = 'info' | 'warn' | 'error';

/** Stable, structured fields only. Never pass secrets, connection strings, raw queries, or IPs. */
export interface LogFields {
  request_id: string;
  route: string;
  method: string;
  status?: number;
  error_code?: string;
  error_name?: string;
  error_message?: string;
}

export function log(level: LogLevel, event: string, fields: LogFields): void {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    service: 'jaga-daerah-api',
    event,
    ...fields,
  });

  if (level === 'error') {
    console.error(entry);
  } else if (level === 'warn') {
    console.warn(entry);
  } else {
    console.info(entry);
  }
}
