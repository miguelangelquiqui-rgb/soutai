export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { home, away, league, leagueSlug, homeRecord, awayRecord, status, score, context } = req.body;
  if (!home || !away) return res.status(400).json({ error: 'Missing teams' });

  // ═══════════════════════════════════════════
  // STEP 1: Fetch ESPN standings → real stats
  // ═══════════════════════════════════════════
  let homeStats = null, awayStats = null, leagueAvg = null;
  let standingsText = '';

  if (leagueSlug) {
    try {
      const sr = await fetch(
        `https://site.api.espn.com/apis/v2/sports/soccer/${leagueSlug}/standings`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } }
      );
      if (sr.ok) {
        const sd = await sr.json();
        const entries = [];
        for (const group of (sd.children || [])) {
          for (const entry of (group.standings?.entries || [])) entries.push(entry);
        }
        if (!entries.length) {
          for (const entry of (sd.standings?.entries || [])) entries.push(entry);
        }

        const parseEntry = (entry) => {
          const s = {};
          (entry.stats || []).forEach(st => { s[st.name] = parseFloat(st.value || st.displayValue) || 0; });
          return {
            name: entry.team?.displayName || '',
            pos: s.rank || 0,
            wins: s.wins || 0,
            draws: s.ties || 0,
            losses: s.losses || 0,
            gf: s.pointsFor || s.goalsFor || 0,
            ga: s.pointsAgainst || s.goalsAgainst || 0,
            pts: s.points || 0,
            gp: (s.wins || 0) + (s.ties || 0) + (s.losses || 0)
          };
        };

        const findTeam = (name) => {
          return entries.find(e => {
            const tn = e.team?.displayName || e.team?.name || '';
            return tn.toLowerCase().includes(name.toLowerCase()) ||
                   name.toLowerCase().includes(tn.toLowerCase());
          });
        };

        const homeEntry = findTeam(home);
        const awayEntry = findTeam(away);
        if (homeEntry) homeStats = parseEntry(homeEntry);
        if (awayEntry) awayStats = parseEntry(awayEntry);

        // League averages from all teams
        if (entries.length > 0) {
          let totalGF = 0, totalGP = 0;
          entries.forEach(e => {
            const p = parseEntry(e);
            totalGF += p.gf;
            totalGP += p.gp;
          });
          leagueAvg = totalGP > 0 ? totalGF / totalGP : 1.3;
        }

        const fmt = (s, label) => s
          ? `${label}: Pos ${s.pos}, ${s.wins}W-${s.draws}D-${s.losses}L, GF:${s.gf} GA:${s.ga}, Pts:${s.pts}, ${s.gp} partidos`
          : `${label}: Sin datos de tabla`;

        standingsText = `\n\nDATOS REALES DE TABLA (${league}):\n${fmt(homeStats, home)}\n${fmt(awayStats, away)}\nPromedio goles/partido liga: ${leagueAvg ? leagueAvg.toFixed(2) : 'N/D'}`;
      }
    } catch {}
  }

  // ═══════════════════════════════════════════
  // STEP 2: Poisson model → math probabilities
  // ═══════════════════════════════════════════
  let poissonText = '';
  let poissonData = null;

  if (homeStats && awayStats && leagueAvg && homeStats.gp >= 2 && awayStats.gp >= 2) {
    const avgGoals = leagueAvg || 1.3;

    // Attack & defense strengths
    const homeAttack = (homeStats.gf / homeStats.gp) / avgGoals;
    const homeDefense = (homeStats.ga / homeStats.gp) / avgGoals;
    const awayAttack = (awayStats.gf / awayStats.gp) / avgGoals;
    const awayDefense = (awayStats.ga / awayStats.gp) / avgGoals;

    // Expected goals (with home advantage factor 1.15)
    const homeXG = homeAttack * awayDefense * avgGoals * 1.15;
    const awayXG = awayAttack * homeDefense * avgGoals * 0.85;

    // Poisson probability function
    const poisson = (lambda, k) => {
      let f = 1;
      for (let i = 1; i <= k; i++) f *= i;
      return (Math.pow(lambda, k) * Math.exp(-lambda)) / f;
    };

    // Calculate score matrix (0-0 to 6-6)
    let homeWin = 0, draw = 0, awayWin = 0;
    let btts = 0, over25 = 0, under25 = 0;
    const scores = [];

    for (let h = 0; h <= 6; h++) {
      for (let a = 0; a <= 6; a++) {
        const p = poisson(homeXG, h) * poisson(awayXG, a);
        if (h > a) homeWin += p;
        else if (h === a) draw += p;
        else awayWin += p;
        if (h > 0 && a > 0) btts += p;
        if (h + a > 2) over25 += p;
        if (h + a < 3) under25 += p;
        scores.push({ h, a, p });
      }
    }

    // Normalize
    const total = homeWin + draw + awayWin;
    homeWin = (homeWin / total * 100);
    draw = (draw / total * 100);
    awayWin = (awayWin / total * 100);
    btts = btts / total * 100;
    over25 = over25 / total * 100;
    under25 = under25 / total * 100;

    // Most probable score
    scores.sort((a, b) => b.p - a.p);
    const topScore = scores[0];

    // Fair odds (no margin)
    const homeOdds = (100 / homeWin).toFixed(2);
    const drawOdds = (100 / draw).toFixed(2);
    const awayOdds = (100 / awayWin).toFixed(2);

    poissonData = {
      homeXG: homeXG.toFixed(2),
      awayXG: awayXG.toFixed(2),
      homeWin: homeWin.toFixed(1),
      draw: draw.toFixed(1),
      awayWin: awayWin.toFixed(1),
      homeOdds, drawOdds, awayOdds,
      btts: btts.toFixed(1),
      over25: over25.toFixed(1),
      under25: under25.toFixed(1),
      topScore: `${topScore.h}-${topScore.a}`,
      topScoreProb: (topScore.p / total * 100).toFixed(1)
    };

    poissonText = `\n\n═══ MODELO POISSON (datos matemáticos verificados) ═══
xG Local (${home}): ${poissonData.homeXG} goles esperados
xG Visitante (${away}): ${poissonData.awayXG} goles esperados
Fuerza ataque local: ${homeAttack.toFixed(2)} | Fuerza defensa local: ${homeDefense.toFixed(2)}
Fuerza ataque visitante: ${awayAttack.toFixed(2)} | Fuerza defensa visitante: ${awayDefense.toFixed(2)}
Factor localía aplicado: 1.15x ataque local, 0.85x ataque visitante

PROBABILIDADES POISSON:
Victoria ${home}: ${poissonData.homeWin}% (cuota justa: ${homeOdds})
Empate: ${poissonData.draw}% (cuota justa: ${drawOdds})
Victoria ${away}: ${poissonData.awayWin}% (cuota justa: ${awayOdds})
Ambos anotan: ${poissonData.btts}%
Más de 2.5 goles: ${poissonData.over25}%
Menos de 2.5 goles: ${poissonData.under25}%
Marcador más probable: ${poissonData.topScore} (${poissonData.topScoreProb}%)

IMPORTANTE: Estos son tus datos BASE. Puedes ajustar ±5% máximo por factores cualitativos (lesiones, motivación, H2H). Justifica cada ajuste.`;
  }

  // ═══════════════════════════════════════════
  // STEP 3: Live match context
  // ═══════════════════════════════════════════
  let liveContext = '';
  if (status === 'live' && score) {
    liveContext = `\n\n⚠️ PARTIDO EN VIVO — MARCADOR: ${home} ${score} ${away}
Ajusta análisis al estado actual del juego.`;
  } else if (status === 'finished' && score) {
    liveContext = `\n\n✅ FINALIZADO — RESULTADO: ${home} ${score} ${away}
Analiza el resultado final.`;
  }

  let contextData = context ? `\nCONTEXTO: ${context}` : '';
  let recordsData = (homeRecord || awayRecord) ? `\nRÉCORD: ${home}: ${homeRecord || 'N/A'} | ${away}: ${awayRecord || 'N/A'}` : '';

  // ═══════════════════════════════════════════
  // STEP 4: Build prompt with Poisson + search
  // ═══════════════════════════════════════════
  const today = new Date().toISOString().split('T')[0];

  const prompt = `Eres un analista deportivo profesional. Tienes un modelo estadístico Poisson ya calculado — ÚSALO como base para tus probabilidades.

PARTIDO: ${home} vs ${away}
COMPETICIÓN: ${league}${contextData}
FECHA: ${today}
ESTADO: ${status === 'live' ? 'EN VIVO' : status === 'finished' ? 'FINALIZADO' : 'POR JUGAR'}${score ? `\nMARCADOR: ${score}` : ''}
${standingsText}${recordsData}${poissonText}${liveContext}

INSTRUCCIONES:
- ${poissonData ? 'USA las probabilidades del modelo Poisson como BASE. Solo ajusta ±5% máximo con justificación (lesiones clave, sanciones, motivación extrema, H2H reciente)' : 'No hay datos suficientes para Poisson. Calcula tus propias probabilidades buscando datos reales en internet'}
- Busca en internet: forma reciente real (últimos 5 partidos con resultados), lesiones/bajas confirmadas HOY, alineación probable si está disponible, historial H2H últimos 5 partidos
- Si no encuentras un dato, escribe N/D — NUNCA inventes
- Responde SOLO con líneas etiquetadas

PICK: equipo ganador o Empate
CONF: 1-100 (basado en solidez de datos)
SUMMARY: 2 oraciones español con datos verificados
PH: prob local % ${poissonData ? `(Poisson: ${poissonData.homeWin}%, ajusta si tienes razón)` : ''}
PD: prob empate % ${poissonData ? `(Poisson: ${poissonData.draw}%)` : ''}
PA: prob visitante % ${poissonData ? `(Poisson: ${poissonData.awayWin}%)` : ''}
OH: cuota justa local ${poissonData ? `(Poisson: ${poissonData.homeOdds})` : ''}
OD: cuota justa empate ${poissonData ? `(Poisson: ${poissonData.drawOdds})` : ''}
OA: cuota justa visitante ${poissonData ? `(Poisson: ${poissonData.awayOdds})` : ''}
HFORM: últimos 5 reales W-D-L (solo letras separadas por guion)
HGF: goles/partido promedio
HGA: goles concedidos promedio
HREC: récord temporada
HINJ: lesiones confirmadas o N/D
HPOS: posición tabla
AFORM: últimos 5 reales W-D-L (solo letras separadas por guion)
AGF: goles/partido promedio
AGA: goles concedidos promedio
AREC: récord temporada
AINJ: lesiones confirmadas o N/D
APOS: posición tabla
H2N: partidos H2H recientes
H2HW: victorias local H2H
H2D: empates H2H
H2AW: victorias visitante H2H
H2LAST: último H2H resultado
BTTS: prob ambos anotan % ${poissonData ? `(Poisson: ${poissonData.btts}%)` : ''}
O25: prob +2.5 goles % ${poissonData ? `(Poisson: ${poissonData.over25}%)` : ''}
U25: prob -2.5 goles % ${poissonData ? `(Poisson: ${poissonData.under25}%)` : ''}
CS: marcador más probable ${poissonData ? `(Poisson: ${poissonData.topScore})` : ''}
FG: primer goleador probable
CORNERS_H: corners promedio local (número)
CORNERS_A: corners promedio visitante (número)
CORNERS_TOTAL: total esperado (número)
CORNERS_PICK: predicción en texto (ej: Over 9.5)
CARDS_H: tarjetas promedio local (número)
CARDS_A: tarjetas promedio visitante (número)
CARDS_TOTAL: total esperado (número)
CARDS_PICK: predicción en texto (ej: Over 4.5)
PENALTY_PROB: prob penal % (número)
HT_PICK: resultado medio tiempo en texto
ANALYSIS: 3-4 oraciones análisis táctico español con datos reales. Si usaste Poisson, menciona los xG y cualquier ajuste que hiciste
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
VBET: descripción
VOP: prob real %
VMP: prob mercado %
VMO: cuota mercado
VEDGE: ventaja %
VK: Kelly %
VV: explicación español`;

  // ═══════════════════════════════════════════
  // STEP 5: Call Claude with web search
  // ═══════════════════════════════════════════
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
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
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
      if (block.type === 'text' && block.text) resultText += block.text + '\n';
    }

    if (!resultText.trim()) throw new Error('Empty AI response');

    // Strip markdown formatting from Claude's response
    resultText = resultText.replace(/\*\*/g, '').replace(/\*/g, '').replace(/__/g, '');

    return res.status(200).json({
      result: resultText.trim(),
      source: 'live',
      model: poissonData ? 'poisson+ai' : 'ai-only',
      poisson: poissonData || null
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
