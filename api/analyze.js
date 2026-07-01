export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { home, away, league } = req.body;
  if (!home || !away) return res.status(400).json({ error: 'Missing data' });

  const prompt = `Eres un analista profesional de apuestas deportivas con 20 años de experiencia. Analiza este partido y responde SOLO con las líneas etiquetadas, sin texto adicional:

PARTIDO: ${home} vs ${away} - ${league}

PICK: equipo ganador o Empate
CONF: número 0-100
SUMMARY: 2 oraciones en español explicando la predicción
PH: probabilidad local %
PD: probabilidad empate %
PA: probabilidad visitante %
OH: cuota local decimal
OD: cuota empate decimal
OA: cuota visitante decimal
HFORM: W-W-D-L-W
HGF: promedio goles anotados
HGA: promedio goles concedidos
HREC: récord temporada
HINJ: estado plantilla
HPOS: posición tabla
AFORM: W-D-L-W-W
AGF: promedio goles
AGA: promedio concedidos
AREC: récord visitante
AINJ: estado plantilla
APOS: posición tabla
H2N: encuentros directos
H2HW: victorias local H2H
H2D: empates H2H
H2AW: victorias visitante H2H
H2LAST: último resultado
BTTS: prob ambos anotan %
O25: prob más 2.5 goles %
U25: prob menos 2.5 goles %
CS: marcador más probable
FG: primer goleador probable
CORNERS_H: corners local promedio
CORNERS_A: corners visitante promedio
CORNERS_TOTAL: total corners esperados
CORNERS_PICK: apuesta corners
CARDS_H: tarjetas local promedio
CARDS_A: tarjetas visitante promedio
CARDS_TOTAL: total tarjetas esperadas
CARDS_PICK: apuesta tarjetas
PENALTY_PROB: prob penal %
HT_PICK: resultado descanso probable
ANALYSIS: 3 oraciones análisis profundo español
F1: factor clave 1
F1T: pos
F2: factor clave 2
F2T: neg
F3: factor clave 3
F3T: neu
F4: factor clave 4
F4T: pos
F5: factor clave 5
F5T: neg
VEX: yes o no
VBET: descripción value bet
VOP: prob modelo %
VMP: prob mercado %
VMO: cuota mercado
VEDGE: ventaja %
VK: kelly % bankroll
VV: veredicto final español`;

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
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: err });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text;
    if (!text) return res.status(500).json({ error: 'No response from AI' });
    
    res.status(200).json({ result: text });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
