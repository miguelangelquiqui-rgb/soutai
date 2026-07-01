export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { home, away, league, leagueSlug, homeRecord, awayRecord } = req.body;
  if (!home || !away) return res.status(400).json({ error: 'Missing teams' });

  // ── Step 1: Fetch real standings from ESPN ──
  let standingsData = '';
  if (leagueSlug) {
    try {
      const sr = await fetch(
        `https://site.api.espn.com/apis/v2/sports/soccer/${leagueSlug}/standings`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } }
      );
      if (sr.ok) {
        const sd = await sr.json();
        const entries = [];
        const children = sd.children || [];
        for (const group of children) {
          const standings = group.standings?.entries || [];
          for (const entry of standings) {
            entries.push(entry);
          }
        }
        // If no children, try direct standings
        if (!entries.length) {
          const direct = sd.standings?.entries || [];
          for (const entry of direct) entries.push(entry);
        }

        const findTeam = (name) => {
          return entries.find(e => {
            const tn = e.team?.displayName || e.team?.name || '';
            return tn.toLowerCase().includes(name.toLowerCase()) ||
                   name.toLowerCase().includes(tn.toLowerCase());
          });
        };

        const homeTeam = findTeam(home);
        const awayTeam = findTeam(away);

        const extractStats = (entry, label) => {
          if (!entry) return `${label}: Sin datos de tabla disponibles`;
          const s = {};
          (entry.stats || []).forEach(st => { s[st.name] = st.value || st.displayValue || 0; });
          const pos = entry.stats?.find(st => st.name === 'rank')?.value || '?';
          return `${label}: Pos ${pos}, ${s.wins||0}W-${s.ties||0}D-${s.losses||0}L, GF:${s.pointsFor||s.goalsFor||0} GA:${s.pointsAgainst||s.goalsAgainst||0}, Pts:${s.points||0}`;
        };

        standingsData = `\n\nDATOS REALES DE TABLA (${league}):\n${extractStats(homeTeam, home)}\n${extractStats(awayTeam, away)}`;
      }
    } catch {}
  }

  // Add records from scoreboard if available
  let recordsData = '';
  if (homeRecord || awayRecord) {
    recordsData = `\nRÉCORD TEMPORADA: ${home}: ${homeRecord || 'N/A'} | ${away}: ${awayRecord || 'N/A'}`;
  }

  // ── Step 2: Build prompt with real data + web search ──
  const today = new Date().toISOString().split('T')[0];
  const prompt = `Eres un analista deportivo profesional. Analiza este partido con la mayor precisión posible.

PARTIDO: ${home} vs ${away}
COMPETICIÓN: ${league}
FECHA: ${today}
${standingsData}${recordsData}

INSTRUCCIONES:
- Usa los datos reales proporcionados arriba como base
- Busca en internet información ACTUAL sobre: forma reciente de ambos equipos (últimos 5 partidos), lesiones y bajas confirmadas, historial de enfrentamientos directos (H2H), contexto del partido (eliminatoria, fase de grupos, etc.), y noticias recientes relevantes
- Basa tus probabilidades en datos REALES, no inventes
- Si no encuentras datos específicos, indícalo honestamente
- Responde SOLO con las líneas etiquetadas, sin texto adicional

PICK: equipo ganador o Empate
CONF: número 1-100 (confianza real basada en datos)
SUMMARY: 2 oraciones en español explicando la predicción con datos concretos
PH: probabilidad local % (basada en datos reales)
PD: probabilidad empate %
PA: probabilidad visitante %
OH: cuota implícita local
OD: cuota implícita empate
OA: cuota implícita visitante
HFORM: últimos 5 resultados reales del local (W-D-L formato)
HGF: goles por partido promedio real del local
HGA: goles concedidos promedio real del local
HREC: récord real de la temporada (ej: 8W-3D-2L)
HINJ: lesiones/bajas confirmadas del local
HPOS: posición real en la tabla
AFORM: últimos 5 resultados reales del visitante
AGF: goles por partido promedio real del visitante
AGA: goles concedidos promedio real del visitante
AREC: récord real de la temporada
AINJ: lesiones/bajas confirmadas del visitante
APOS: posición real en la tabla
H2N: número de enfrentamientos directos recientes
H2HW: victorias del local en H2H
H2D: empates en H2H
H2AW: victorias del visitante en H2H
H2LAST: último resultado H2H
BTTS: probabilidad ambos anotan %
O25: probabilidad más de 2.5 goles %
U25: probabilidad menos de 2.5 goles %
CS: marcador más probable
FG: primer goleador probable
CORNERS_H: corners promedio local
CORNERS_A: corners promedio visitante
CORNERS_TOTAL: total corners esperado
CORNERS_PICK: predicción corners
CARDS_H: tarjetas promedio local
CARDS_A: tarjetas promedio visitante
CARDS_TOTAL: total tarjetas esperado
CARDS_PICK: predicción tarjetas
PENALTY_PROB: probabilidad de penal %
HT_PICK: resultado al medio tiempo
ANALYSIS: 3-4 oraciones en español con análisis táctico real basado en los datos encontrados
F1: factor clave 1 en español (basado en datos reales)
F1T: pos o neg o neu
F2: factor clave 2
F2T: pos o neg o neu
F3: factor clave 3
F3T: pos o neg o neu
F4: factor clave 4
F4T: pos o neg o neu
F5: factor clave 5
F5T: pos o neg o neu
VEX: yes o no (solo si hay value bet claro basado en datos)
VBET: descripción del value bet
VOP: probabilidad real según tu análisis %
VMP: probabilidad implícita del mercado %
VMO: cuota del mercado
VEDGE: ventaja sobre el mercado %
VK: porcentaje Kelly recomendado
VV: explicación del value en español`;

  // ── Step 3: Call Claude with web search enabled ──
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
        tools: [
          { type: 'web_search_20250305', name: 'web_search' }
        ],
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error?.message || `API ${response.status}`);
    }

    const data = await response.json();

    // Extract text from response (may have multiple content blocks with web search)
    let resultText = '';
    for (const block of (data.content || [])) {
      if (block.type === 'text' && block.text) {
        resultText += block.text + '\n';
      }
    }

    if (!resultText.trim()) throw new Error('Empty response from AI');

    return res.status(200).json({ result: resultText.trim(), source: 'live' });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
