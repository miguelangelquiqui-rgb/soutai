export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { home, away, league, leagueSlug, homeRecord, awayRecord, status, score, context } = req.body;
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
          for (const entry of standings) entries.push(entry);
        }
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

  // Records from scoreboard
  let recordsData = '';
  if (homeRecord || awayRecord) {
    recordsData = `\nRÉCORD TEMPORADA: ${home}: ${homeRecord || 'N/A'} | ${away}: ${awayRecord || 'N/A'}`;
  }

  // Live match context
  let liveContext = '';
  if (status === 'live' && score) {
    liveContext = `\n\n⚠️ PARTIDO EN VIVO — MARCADOR ACTUAL: ${home} ${score} ${away}
Este partido está EN CURSO. Tu análisis DEBE considerar el marcador actual.
- Analiza quién tiene más probabilidad de ganar DESDE ESTE PUNTO del partido
- Ajusta todas las probabilidades al estado actual del juego
- Si un equipo va perdiendo, refleja eso en las probabilidades
- Indica cómo podría cambiar el resultado desde el marcador actual`;
  } else if (status === 'finished' && score) {
    liveContext = `\n\n✅ PARTIDO FINALIZADO — RESULTADO: ${home} ${score} ${away}
Analiza el resultado final, qué pasó y por qué.`;
  }

  // Context (e.g. "Round of 32", "Dieciseisavos")
  let contextData = '';
  if (context) {
    contextData = `\nCONTEXTO: ${context}`;
  }

  // ── Step 2: Build prompt ──
  const today = new Date().toISOString().split('T')[0];
  const prompt = `Eres un analista deportivo profesional con acceso a datos en tiempo real. Analiza este partido con la mayor precisión posible.

PARTIDO: ${home} vs ${away}
COMPETICIÓN: ${league}${contextData}
FECHA: ${today}
ESTADO: ${status === 'live' ? 'EN VIVO' : status === 'finished' ? 'FINALIZADO' : 'POR JUGAR'}${score ? `\nMARCADOR: ${score}` : ''}
${standingsData}${recordsData}${liveContext}

INSTRUCCIONES CRÍTICAS:
- Busca en internet información ACTUAL sobre este partido: forma reciente (últimos 5 partidos reales), lesiones confirmadas, alineaciones si están disponibles, historial H2H, y noticias del día
- Si el partido está EN VIVO, el marcador actual es lo MÁS IMPORTANTE — ajusta todo a la realidad del juego
- Basa TODAS las probabilidades en datos verificados, no inventes cifras
- Si no encuentras un dato, pon "N/D" en vez de inventar
- Responde SOLO con líneas etiquetadas, sin texto adicional ni explicaciones fuera del formato

PICK: equipo ganador o Empate
CONF: número 1-100
SUMMARY: 2 oraciones en español con datos concretos verificados
PH: probabilidad local %
PD: probabilidad empate %
PA: probabilidad visitante %
OH: cuota implícita local
OD: cuota implícita empate
OA: cuota implícita visitante
HFORM: últimos 5 resultados reales W-D-L
HGF: goles por partido promedio
HGA: goles concedidos promedio
HREC: récord temporada
HINJ: lesiones/bajas confirmadas o N/D
HPOS: posición en tabla
AFORM: últimos 5 resultados reales W-D-L
AGF: goles por partido promedio
AGA: goles concedidos promedio
AREC: récord temporada
AINJ: lesiones/bajas confirmadas o N/D
APOS: posición en tabla
H2N: enfrentamientos directos recientes
H2HW: victorias local H2H
H2D: empates H2H
H2AW: victorias visitante H2H
H2LAST: último resultado H2H
BTTS: prob ambos anotan %
O25: prob +2.5 goles %
U25: prob -2.5 goles %
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
PENALTY_PROB: probabilidad penal %
HT_PICK: resultado medio tiempo
ANALYSIS: 3-4 oraciones análisis táctico en español con datos reales verificados
F1: factor clave 1 español
F1T: pos o neg o neu
F2: factor clave 2
F2T: pos o neg o neu
F3: factor clave 3
F3T: pos o neg o neu
F4: factor clave 4
F4T: pos o neg o neu
F5: factor clave 5
F5T: pos o neg o neu
VEX: yes o no
VBET: descripción value bet
VOP: prob real según análisis %
VMP: prob implícita mercado %
VMO: cuota mercado
VEDGE: ventaja %
VK: porcentaje Kelly
VV: explicación value en español`;

  // ── Step 3: Call Claude with web search ──
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
    let resultText = '';
    for (const block of (data.content || [])) {
      if (block.type === 'text' && block.text) {
        resultText += block.text + '\n';
      }
    }

    if (!resultText.trim()) throw new Error('Empty AI response');
    return res.status(200).json({ result: resultText.trim(), source: 'live' });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
