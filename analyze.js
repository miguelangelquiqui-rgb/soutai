export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { home, away, league } = req.body;
  if (!home || !away) return res.status(400).json({ error: 'Missing match data' });

  const prompt = `Sports analyst. Analyze: ${home} vs ${away}, ${league}, June 2026.
Reply ONLY with these labeled lines, nothing else before or after:
PICK: winner name or Empate
CONF: confidence number 0-100
SUMMARY: 2 sentences in Spanish explaining the prediction
PH: home win probability percent number only
PD: draw probability percent number only
PA: away win probability percent number only
OH: home odds decimal number only
OD: draw odds decimal number only
OA: away odds decimal number only
HFORM: last 5 results like W-W-D-L-W
HGF: home avg goals scored number only
HGA: home avg goals conceded number only
HREC: home record this season text
HINJ: home key player injuries or status text
HPOS: home table position text
AFORM: away last 5 results like W-D-L-W-W
AGF: away avg goals scored number only
AGA: away avg goals conceded number only
AREC: away record this season text
AINJ: away key player injuries or status text
APOS: away table position text
H2N: number of recent head to head meetings
H2HW: home wins in head to head number
H2D: draws in head to head number
H2AW: away wins in head to head number
H2LAST: last meeting result text
BTTS: both teams score probability percent number only
O25: over 2.5 goals probability percent number only
U25: under 2.5 goals probability percent number only
CS: most likely correct scoreline
FG: most likely first goalscorer name
ANALYSIS: 3 sentences detailed analysis in Spanish with tactical and statistical context
F1: key factor 1 in Spanish
F1T: pos
F2: key factor 2 in Spanish
F2T: neg
F3: key factor 3 in Spanish
F3T: neu
F4: key factor 4 in Spanish
F4T: pos
F5: key factor 5 in Spanish
F5T: neu
VEX: yes or no whether a value bet exists
VBET: value bet description text
VOP: our model probability percent number only
VMP: market implied probability percent number only
VMO: market odds decimal number only
VEDGE: edge percentage number only
VK: kelly criterion bankroll percentage number only
VV: one sentence verdict in Spanish`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1200,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: err });
    }

    const data = await response.json();
    const text = data.content[0].text;
    res.status(200).json({ result: text });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
