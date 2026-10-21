const baseUrl = process.env.ATAS_URL ?? 'http://localhost:8080';
const token = process.env.ATAS_TOKEN;
const headers: Record<string, string> = { 'content-type': 'application/json' };
if (token !== undefined) headers.authorization = `Bearer ${token}`;

const response = await fetch(`${baseUrl}/v1/matches`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    competition: 'ATAS Demonstration',
    homeTeam: 'Home',
    awayTeam: 'Away',
    metadata: { demo: true },
  }),
});
if (!response.ok) throw new Error(`Seed failed: ${response.status} ${await response.text()}`);
const match = (await response.json()) as { id: string };
process.stdout.write(`${JSON.stringify(match, null, 2)}\n`);
