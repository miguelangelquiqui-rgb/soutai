export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { home, away, league, leagueSlug, homeRecord, awayRecord, status, score, context } = req.body;
  if (!home || !away) return res.status(400).json({ error: 'Missing teams' });

  // ══════════════════════════════════════════════════════
  // STEP 1: Parallel data fetching (ESPN + Odds API)
  // ══════════════════════════════════════════════════════
  let homeStats = null, awayStats = null, leagueAvg = null;
  let oddsData = null;
  let standingsText = '', oddsText = '';

  const fetchStandings = async () => {
    if (!leagueSlug) return;
    try {
      const sr = await fetch(
        `https://site.api.espn.com/apis/v2/sports/soccer/${leagueSlug}/standings`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } }
      );
      if (!sr.ok) return;
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
          wins: s.wins || 0, draws: s.ties || 0, losses: s.losses || 0,
          gf: s.pointsFor || s.goalsFor || 0,
          ga: s.pointsAgainst || s.goalsAgainst || 0,
          pts: s.points || 0,
          gp: (s.wins || 0) + (s.ties || 0) + (s.losses || 0),
          // Home/away splits if available
          homeWins: s.homeWins || 0, homeDraws: s.homeDraws || s.homeTies || 0, homeLosses: s.homeLosses || 0,
          homeGF: s.homePointsFor || s.homeGoalsFor || 0, homeGA: s.homePointsAgainst || s.homeGoalsAgainst || 0,
          awayWins: s.awayWins || 0, awayDraws: s.awayDraws || s.awayTies || 0, awayLosses: s.awayLosses || 0,
          awayGF: s.awayPointsFor || s.awayGoalsFor || 0, awayGA: s.awayPointsAgainst || s.awayGoalsAgainst || 0,
        };
      };

      const findTeam = (name) => entries.find(e => {
        const tn = e.team?.displayName || e.team?.name || '';
        return tn.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(tn.toLowerCase());
      });

      const he = findTeam(home), ae = findTeam(away);
      if (he) homeStats = parseEntry(he);
      if (ae) awayStats = parseEntry(ae);

      // League averages
      if (entries.length > 0) {
        let totalGF = 0, totalGP = 0;
        entries.forEach(e => { const p = parseEntry(e); totalGF += p.gf; totalGP += p.gp; });
        leagueAvg = totalGP > 0 ? totalGF / totalGP : 1.3;
      }

      const fmt = (s, label) => s
        ? `${label}: Pos ${s.pos}, ${s.wins}W-${s.draws}D-${s.losses}L, GF:${s.gf} GA:${s.ga}, Pts:${s.pts}, ${s.gp}GP` +
          (s.homeGF > 0 ? ` | HOME: ${s.homeWins}W-${s.homeDraws}D-${s.homeLosses}L GF:${s.homeGF} GA:${s.homeGA}` : '') +
          (s.awayGF > 0 ? ` | AWAY: ${s.awayWins}W-${s.awayDraws}D-${s.awayLosses}L GF:${s.awayGF} GA:${s.awayGA}` : '')
        : `${label}: Sin datos`;
      standingsText = `\n\nDATOS ESPN (${league}):\n${fmt(homeStats, home)}\n${fmt(awayStats, away)}\nProm goles/p liga: ${leagueAvg?.toFixed(2) || 'N/D'}`;
    } catch {}
  };

  // Fetch real odds from The Odds API
  const fetchOdds = async () => {
    const key = process.env.ODDS_API_KEY;
    if (!key) return;
    try {
      // Map league slugs to Odds API sport keys
      const sportMap = {
        'fifa.world': 'soccer_fifa_world_cup',
        'eng.1': 'soccer_epl',
        'esp.1': 'soccer_spain_la_liga',
        'ger.1': 'soccer_germany_bundesliga',
        'ita.1': 'soccer_italy_serie_a',
        'fra.1': 'soccer_france_ligue_one',
        'usa.1': 'soccer_usa_mls',
        'mex.1': 'soccer_mexico_ligamx',
        'col.1': 'soccer_colombia_primera_a',
        'conmebol.libertadores': 'soccer_conmebol_copa_libertadores',
        'uefa.champions': 'soccer_uefa_champs_league',
      };
      const sportKey = sportMap[leagueSlug];
      if (!sportKey) return;

      const or = await fetch(
        `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${key}&regions=eu,uk&markets=h2h,totals&oddsFormat=decimal`,
        { signal: AbortSignal.timeout(4000) }
      );
      if (!or.ok) return;
      const games = await or.json();

      // Find matching game
      const match = games.find(g => {
        const ht = g.home_team?.toLowerCase() || '';
        const at = g.away_team?.toLowerCase() || '';
        return (ht.includes(home.toLowerCase()) || home.toLowerCase().includes(ht)) &&
               (at.includes(away.toLowerCase()) || away.toLowerCase().includes(at));
      });

      if (match && match.bookmakers?.length > 0) {
        // Get best odds from all bookmakers
        const h2hOdds = { home: [], draw: [], away: [] };
        const totals = { over25: [], under25: [] };

        match.bookmakers.forEach(bk => {
          const h2h = bk.markets?.find(m => m.key === 'h2h');
          if (h2h) {
            h2h.outcomes.forEach(o => {
              if (o.name === match.home_team) h2hOdds.home.push(o.price);
              else if (o.name === 'Draw') h2hOdds.draw.push(o.price);
              else h2hOdds.away.push(o.price);
            });
          }
          const tot = bk.markets?.find(m => m.key === 'totals');
          if (tot) {
            tot.outcomes.forEach(o => {
              if (o.name === 'Over' && o.point === 2.5) totals.over25.push(o.price);
              if (o.name === 'Under' && o.point === 2.5) totals.under25.push(o.price);
            });
          }
        });

        const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
        const toProb = odds => odds > 0 ? (100 / odds) : 0;

        oddsData = {
          homeOdds: avg(h2hOdds.home).toFixed(2),
          drawOdds: avg(h2hOdds.draw).toFixed(2),
          awayOdds: avg(h2hOdds.away).toFixed(2),
          homeProb: toProb(avg(h2hOdds.home)).toFixed(1),
          drawProb: toProb(avg(h2hOdds.draw)).toFixed(1),
          awayProb: toProb(avg(h2hOdds.away)).toFixed(1),
          over25Odds: avg(totals.over25).toFixed(2),
          under25Odds: avg(totals.under25).toFixed(2),
          bookmakers: match.bookmakers.length,
        };

        oddsText = `\n\n═══ CUOTAS REALES DEL MERCADO (${oddsData.bookmakers} casas) ═══
${home}: ${oddsData.homeOdds} (prob implícita: ${oddsData.homeProb}%)
Empate: ${oddsData.drawOdds} (prob implícita: ${oddsData.drawProb}%)
${away}: ${oddsData.awayOdds} (prob implícita: ${oddsData.awayProb}%)
Over 2.5: ${oddsData.over25Odds} | Under 2.5: ${oddsData.under25Odds}
NOTA: Las probabilidades del mercado incluyen margen (~5-8%). Las probabilidades reales son ligeramente mayores.`;
      }
    } catch {}
  };

  // Fetch both in parallel
  await Promise.allSettled([fetchStandings(), fetchOdds()]);

  // ══════════════════════════════════════════════════════
  // STEP 2: Advanced Poisson with home/away splits
  // ══════════════════════════════════════════════════════
  let poissonText = '', poissonData = null;

  if (homeStats && awayStats && leagueAvg && homeStats.gp >= 2 && awayStats.gp >= 2) {
    const avgGoals = leagueAvg || 1.3;

    // Try home/away splits first, fallback to general
    const homeGP_home = homeStats.homeWins + homeStats.homeDraws + homeStats.homeLosses;
    const awayGP_away = awayStats.awayWins + awayStats.awayDraws + awayStats.awayLosses;
    const useSplits = homeGP_home >= 2 && awayGP_away >= 2;

    let homeAttack, homeDefense, awayAttack, awayDefense;

    if (useSplits) {
      // MEJORA 1: Home/away splits — más preciso
      homeAttack = (homeStats.homeGF / homeGP_home) / avgGoals;
      homeDefense = (homeStats.homeGA / homeGP_home) / avgGoals;
      awayAttack = (awayStats.awayGF / awayGP_away) / avgGoals;
      awayDefense = (awayStats.awayGA / awayGP_away) / avgGoals;
    } else {
      homeAttack = (homeStats.gf / homeStats.gp) / avgGoals;
      homeDefense = (homeStats.ga / homeStats.gp) / avgGoals;
      awayAttack = (awayStats.gf / awayStats.gp) / avgGoals;
      awayDefense = (awayStats.ga / awayStats.gp) / avgGoals;
    }

    // MEJORA 2: Smart home advantage by tournament type
    let homeAdv = 1.15, awayPen = 0.85; // Default league
    const isWorldCup = leagueSlug === 'fifa.world';
    const isNeutral = isWorldCup; // World Cup = mostly neutral venues
    const isHostNation = isWorldCup && (
      home.toLowerCase().includes('united states') || home.toLowerCase().includes('usa') ||
      home.toLowerCase().includes('canada') || home.toLowerCase().includes('mexico') ||
      home.toLowerCase().includes('méxico')
    );
    if (isNeutral && !isHostNation) { homeAdv = 1.02; awayPen = 0.98; }
    else if (isHostNation) { homeAdv = 1.20; awayPen = 0.80; }

    // Expected goals
    const homeXG = Math.max(0.3, homeAttack * awayDefense * avgGoals * homeAdv);
    const awayXG = Math.max(0.3, awayAttack * homeDefense * avgGoals * awayPen);

    // MEJORA 3: Calibration with market odds
    let calibratedHomeXG = homeXG, calibratedAwayXG = awayXG;
    if (oddsData) {
      const marketHomeProb = parseFloat(oddsData.homeProb) / 100;
      const marketAwayProb = parseFloat(oddsData.awayProb) / 100;
      // Blend Poisson with market (60% Poisson, 40% market)
      // This smooths outliers from both models
      const poissonHomeWinRaw = calcWinProb(homeXG, awayXG, 'home');
      const poissonAwayWinRaw = calcWinProb(homeXG, awayXG, 'away');
      if (poissonHomeWinRaw > 0 && marketHomeProb > 0) {
        const blendedHome = poissonHomeWinRaw * 0.6 + marketHomeProb * 0.4;
        const blendedAway = poissonAwayWinRaw * 0.6 + marketAwayProb * 0.4;
        // Adjust xG to match blended probabilities (approximate)
        const ratio = blendedHome / (poissonHomeWinRaw || 0.01);
        calibratedHomeXG = homeXG * Math.pow(ratio, 0.3);
        calibratedAwayXG = awayXG * Math.pow((blendedAway / (poissonAwayWinRaw || 0.01)), 0.3);
      }
    }

    // Poisson distribution
    const poisson = (lambda, k) => {
      let f = 1; for (let i = 1; i <= k; i++) f *= i;
      return (Math.pow(lambda, k) * Math.exp(-lambda)) / f;
    };

    // Score matrix
    let homeWin = 0, draw = 0, awayWin = 0;
    let btts = 0, over25 = 0, under25 = 0;
    const scores = [];
    const xH = calibratedHomeXG, xA = calibratedAwayXG;

    for (let h = 0; h <= 6; h++) {
      for (let a = 0; a <= 6; a++) {
        const p = poisson(xH, h) * poisson(xA, a);
        if (h > a) homeWin += p;
        else if (h === a) draw += p;
        else awayWin += p;
        if (h > 0 && a > 0) btts += p;
        if (h + a > 2) over25 += p;
        if (h + a < 3) under25 += p;
        scores.push({ h, a, p });
      }
    }

    const total = homeWin + draw + awayWin;
    homeWin = homeWin / total * 100;
    draw = draw / total * 100;
    awayWin = awayWin / total * 100;
    btts = btts / total * 100;
    over25 = over25 / total * 100;
    under25 = under25 / total * 100;
    scores.sort((a, b) => b.p - a.p);
    const topScore = scores[0];

    poissonData = {
      homeXG: xH.toFixed(2), awayXG: xA.toFixed(2),
      homeWin: homeWin.toFixed(1), draw: draw.toFixed(1), awayWin: awayWin.toFixed(1),
      homeOdds: (100 / homeWin).toFixed(2), drawOdds: (100 / draw).toFixed(2), awayOdds: (100 / awayWin).toFixed(2),
      btts: btts.toFixed(1), over25: over25.toFixed(1), under25: under25.toFixed(1),
      topScore: `${topScore.h}-${topScore.a}`, topScoreProb: (topScore.p / total * 100).toFixed(1),
      usedSplits: useSplits, calibratedWithOdds: !!oddsData,
      homeAdv: homeAdv.toFixed(2),
    };

    poissonText = `\n\n═══ MODELO POISSON AVANZADO ═══
${useSplits ? '✅ Usando datos HOME/AWAY separados (más preciso)' : '⚠️ Usando datos generales (sin splits disponibles)'}
${oddsData ? '✅ Calibrado con cuotas reales del mercado (blend 60% Poisson + 40% mercado)' : '⚠️ Sin calibración de mercado (sin API de cuotas)'}
Factor localía: ${homeAdv}x ${isNeutral ? '(sede neutral)' : isHostNation ? '(selección anfitriona)' : '(liga local)'}
xG ${home}: ${poissonData.homeXG} | xG ${away}: ${poissonData.awayXG}

PROBABILIDADES FINALES:
Victoria ${home}: ${poissonData.homeWin}% (cuota justa: ${poissonData.homeOdds})
Empate: ${poissonData.draw}% (cuota justa: ${poissonData.drawOdds})
Victoria ${away}: ${poissonData.awayWin}% (cuota justa: ${poissonData.awayOdds})
BTTS: ${poissonData.btts}% | Over 2.5: ${poissonData.over25}% | Under 2.5: ${poissonData.under25}%
Marcador más probable: ${poissonData.topScore} (${poissonData.topScoreProb}%)

Ajusta ±3% MÁXIMO por factores cualitativos. Justifica cada ajuste.`;
  }

  // Helper function for calibration
  function calcWinProb(xH, xA, side) {
    const poisson = (lambda, k) => {
      let f = 1; for (let i = 1; i <= k; i++) f *= i;
      return (Math.pow(lambda, k) * Math.exp(-lambda)) / f;
    };
    let prob = 0, total = 0;
    for (let h = 0; h <= 6; h++) {
      for (let a = 0; a <= 6; a++) {
        const p = poisson(xH, h) * poisson(xA, a);
        total += p;
        if (side === 'home' && h > a) prob += p;
        if (side === 'away' && a > h) prob += p;
      }
    }
    return prob / total;
  }

  // ══════════════════════════════════════════════════════
  // STEP 3: Context assembly
  // ══════════════════════════════════════════════════════
  let liveContext = '';
  if (status === 'live' && score) {
    liveContext = `\n\n⚠️ EN VIVO — ${home} ${score} ${away}\nAjusta al estado actual del juego.`;
  } else if (status === 'finished' && score) {
    liveContext = `\n\n✅ FINALIZADO — ${home} ${score} ${away}`;
  }

  const contextData = context ? `\nCONTEXTO: ${context}` : '';
  const recordsData = (homeRecord || awayRecord) ? `\nRÉCORD: ${home}: ${homeRecord || 'N/A'} | ${away}: ${awayRecord || 'N/A'}` : '';
  const today = new Date().toISOString().split('T')[0];

  // ══════════════════════════════════════════════════════
  // STEP 4: Build prompt
  // ══════════════════════════════════════════════════════
  const prompt = `Eres un analista deportivo profesional. Tienes un modelo Poisson avanzado ya calculado${oddsData ? ' y cuotas reales del mercado' : ''} — ÚSALOS como base.

PARTIDO: ${home} vs ${away}
COMPETICIÓN: ${league}${contextData}
FECHA: ${today}
ESTADO: ${status === 'live' ? 'EN VIVO' : status === 'finished' ? 'FINALIZADO' : 'POR JUGAR'}${score ? `\nMARCADOR: ${score}` : ''}
${standingsText}${recordsData}${oddsText}${poissonText}${liveContext}

INSTRUCCIONES:
- USA las probabilidades Poisson como BASE. Ajusta ±3% máximo con justificación verificada
${oddsData ? '- COMPARA tu análisis con las cuotas reales del mercado. Si difieren >10%, explica por qué' : ''}
- Busca en internet: forma reciente real (últimos 5 con resultado), lesiones CONFIRMADAS hoy, alineación probable, H2H últimos 5
- MEJORA 5 - LESIONES: Si encuentras lesiones de titulares clave, estima el impacto en % sobre la fuerza del equipo
- Si no encuentras dato, escribe N/D — NUNCA inventes
- Formato HFORM/AFORM: solo letras W D L separadas por guión (ej: W-W-D-L-W)
- Responde SOLO con líneas etiquetadas, sin markdown

PICK: equipo o Empate
CONF: 1-100
SUMMARY: 2 oraciones español datos verificados
PH: prob local % (Poisson: ${poissonData?.homeWin || '?'}%)
PD: prob empate % (Poisson: ${poissonData?.draw || '?'}%)
PA: prob visitante % (Poisson: ${poissonData?.awayWin || '?'}%)
OH: cuota justa local (Poisson: ${poissonData?.homeOdds || '?'})
OD: cuota justa empate (Poisson: ${poissonData?.drawOdds || '?'})
OA: cuota justa visitante (Poisson: ${poissonData?.awayOdds || '?'})
HFORM: últimos 5 reales solo W-D-L
HGF: goles/p
HGA: concedidos/p
HREC: récord temporada
HINJ: lesiones confirmadas y su impacto estimado (ej: Mbappé baja, -15% ataque) o N/D
HPOS: posición tabla
AFORM: últimos 5 reales solo W-D-L
AGF: goles/p
AGA: concedidos/p
AREC: récord temporada
AINJ: lesiones confirmadas y su impacto o N/D
APOS: posición tabla
H2N: partidos H2H
H2HW: victorias local
H2D: empates
H2AW: victorias visitante
H2LAST: último resultado
BTTS: prob % (Poisson: ${poissonData?.btts || '?'}%)
O25: prob +2.5 % (Poisson: ${poissonData?.over25 || '?'}%)
U25: prob -2.5 % (Poisson: ${poissonData?.under25 || '?'}%)
CS: marcador más probable (Poisson: ${poissonData?.topScore || '?'})
FG: primer goleador probable
CORNERS_H: promedio (número)
CORNERS_A: promedio (número)
CORNERS_TOTAL: total (número)
CORNERS_PICK: predicción texto
CARDS_H: promedio (número)
CARDS_A: promedio (número)
CARDS_TOTAL: total (número)
CARDS_PICK: predicción texto
PENALTY_PROB: prob % (número)
HT_PICK: resultado HT texto
ANALYSIS: 4 oraciones español. Menciona xG del Poisson, ${oddsData ? 'compara con cuotas del mercado, ' : ''}factores de ajuste, y predicción final con justificación
F1: factor clave 1
F1T: pos neg neu
F2: factor 2
F2T: pos neg neu
F3: factor 3
F3T: pos neg neu
F4: factor 4
F4T: pos neg neu
F5: factor 5
F5T: pos neg neu
VEX: yes o no ${oddsData ? '(compara prob Poisson vs prob mercado, si edge >5% = yes)' : ''}
VBET: descripción
VOP: prob real %
VMP: prob mercado %
VMO: cuota mercado
VEDGE: edge %
VK: Kelly %
VV: explicación español`;

  // ══════════════════════════════════════════════════════
  // STEP 5: Call Claude
  // ══════════════════════════════════════════════════════
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
    resultText = resultText.replace(/\*\*/g, '').replace(/\*/g, '').replace(/__/g, '');

    return res.status(200).json({
      result: resultText.trim(),
      source: 'live',
      model: poissonData ? (oddsData ? 'poisson+odds+ai' : 'poisson+ai') : 'ai-only',
      poisson: poissonData || null,
      odds: oddsData || null
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
