/** Migrations need the direct Neon host. The `-pooler` host is for application traffic. */
export function directDatabaseUrl(connectionString: string): string {
  const url = new URL(connectionString);
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL must be a postgres URL');
  }
  if (!url.hostname.includes('-pooler')) {
    return connectionString;
  }
  return connectionString.replace(url.hostname, url.hostname.replace('-pooler', ''));
}
