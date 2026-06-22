export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { home, away, league } = req.body;
  if (!home || !away) return res.status(400).json({ error: 'Missing data' });

  const systemPrompt = `Eres un analista profesional de apuestas deportivas con 20 años de experiencia. 
Trabajas para fondos de inversión en mercados de apuestas y tu especialidad es encontrar value bets con alto retorno esperado.
Tienes acceso a bases de datos estadísticas avanzadas, modelos de probabilidad tipo Poisson, análisis de momentum, y datos de mercado en tiempo real.
Tu análisis es frío, matemático y basado en datos. No te dejas llevar por popularidad de equipos ni narrativas mediáticas.
Siempre calculas el Expected Value (EV) de cada apuesta y solo recomiendas cuando hay ventaja real sobre el mercado.
Respondes SOLO con las líneas etiquetadas que se te piden, sin texto adicional antes ni después.`;

  const prompt = `Analiza este partido con tu metodología profesional de apuestas:
Partido: ${home} vs ${away}
Competición: ${league}
Fecha: Junio 2026

Responde ÚNICAMENTE con estas líneas etiquetadas, sin texto adicional:
PICK: nombre del ganador o Empate
CONF: número de confianza 0-100
SUMMARY: 2 oraciones en español explicando la predicción basada en datos
PH: probabilidad victoria local en %
PD: probabilidad empate en %
PA: probabilidad victoria visitante en %
OH: cuota estimada local decimal
OD: cuota estimada empate decimal
OA: cuota estimada visitante decimal
HFORM: últimos 5 resultados como W-W-D-L-W
HGF: promedio goles anotados por partido
HGA: promedio goles concedidos por partido
HREC: récord esta temporada
HINJ: estado jugadores clave y lesiones
HPOS: posición en tabla o fase del torneo
AFORM: últimos 5 resultados visitante
AGF: promedio goles anotados visitante
AGA: promedio goles concedidos visitante
AREC: récord visitante esta temporada
AINJ: estado jugadores clave visitante
APOS: posición visitante en tabla
H2N: número de enfrentamientos directos recientes
H2HW: victorias local en H2H
H2D: empates en H2H
H2AW: victorias visitante en H2H
H2LAST: resultado último enfrentamiento directo
BTTS: probabilidad ambos equipos anotan en %
O25: probabilidad más de 2.5 goles en %
U25: probabilidad menos de 2.5 goles en %
CS: marcador más probable
FG: primer goleador más probable
CORNERS_H: promedio corners local por partido
CORNERS_A: promedio corners visitante por partido
CORNERS_TOTAL: total corners esperados en el partido
CORNERS_PICK: apuesta corners recomendada
CARDS_H: promedio tarjetas local por partido
CARDS_A: promedio tarjetas visitante por partido
CARDS_TOTAL: total tarjetas esperadas
CARDS_PICK: apuesta tarjetas recomendada
PENALTY_PROB: probabilidad de que haya penal en %
HT_PICK: resultado más probable al descanso
ANALYSIS: 3 oraciones de análisis profundo en español con contexto táctico, estadístico y motivacional
F1: factor clave 1 en español
F1T: pos
F2: factor clave 2 en español
F2T: neg
F3: factor clave 3 en español
F3T: neu
F4: factor clave 4 en español
F4T: pos
F5: factor clave 5 en español
F5T: neg
VEX: yes si hay value bet real, no si no hay
VBET: descripción de la apuesta con valor
VOP: nuestra probabilidad calculada en %
VMP: probabilidad implícita del mercado en %
VMO: cuota de mercado actual
VEDGE: ventaja en porcentaje sobre el mercado
VK: porcentaje del bankroll según criterio Kelly
VV: veredicto final en una oración en español`;

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
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: err });
    }
    const data = await response.json();
    res.status(200).json({ result: data.content[0].text });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
