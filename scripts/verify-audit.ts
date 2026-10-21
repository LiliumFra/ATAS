const baseUrl = process.env.ATAS_URL ?? 'http://localhost:8080';
const matchId = process.argv[2];
const token = process.env.ATAS_TOKEN;
if (matchId === undefined) throw new Error('Usage: npm run audit:verify -- <match-id>');

const response = await fetch(`${baseUrl}/v1/matches/${matchId}/audit/verify`, {
  headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
});
if (!response.ok)
  throw new Error(`Verification failed: ${response.status} ${await response.text()}`);
process.stdout.write(`${JSON.stringify(await response.json(), null, 2)}\n`);
