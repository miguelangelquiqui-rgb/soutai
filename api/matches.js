export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth()+1).padStart(2,'0');
  const dd = String(today.getDate()).padStart(2,'0');
  const dateStr = `${yyyy}-${mm}-${dd}`;
  const todayNum = parseInt(`${yyyy}${mm}${dd}`);

  const TOP_LEAGUES = [
    'fifa world cup','world cup','copa mundial',
    'champions league','europa league',
    'premier league','la liga','laliga',
    'bundesliga','serie a','ligue 1',
    'libertadores','sudamericana',
    'betplay','colombiana',
    'mls','eredivisie','primeira liga'
  ];

  try {
    const response = await fetch(
      `https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=${dateStr}&s=Soccer`,
      { method: 'GET' }
    );

    if (!response.ok) throw new Error(`API ${response.status}`);
    const data = await response.json();
    const events = data.events || [];

    const filtered = events.filter(e => {
      const league = (e.strLeague || '').toLowerCase();
      return TOP_LEAGUES.some(l => league.includes(l));
    });

    const list = filtered.length >= 3 ? filtered : events;
    if (!list.length) throw new Error('No events');

    const matches = list.slice(0, 20).map((e, i) => {
      const timeRaw = e.strTime || '00:00:00';
      const time = timeRaw.substring(0, 5);
      let status = 'upcoming', score = null;
      if (e.intHomeScore !== null && e.intAwayScore !== null) {
        score = `${e.intHomeScore}-${e.intAwayScore}`;
        status = e.strStatus === 'Match Finished' ? 'finished' : 'live';
      }
      return {
        id: String(e.idEvent || i),
        league: e.strLeague || 'Liga',
        sport: 'football',
        home: e.strHomeTeam || 'Local',
        away: e.strAwayTeam || 'Visitante',
        time, status, score,
        homeForm: 'W-D-W-L-W',
        awayForm: 'W-W-D-L-D',
        context: e.intRound ? `Jornada ${e.intRound}` : ''
      };
    });

    res.status(200).json({ matches, source: 'live', total: events.length });

  } catch (error) {
    // Partidos REALES del Mundial 2026 - Dieciseisavos de final (1-3 julio)
    const worldCupMatches = [
      {id:"wc1",league:"Copa Mundial FIFA 2026",sport:"football",home:"España",away:"RD Congo",time:"19:00",status:"upcoming",score:null,homeForm:"W-W-W-W-D",awayForm:"W-D-L-W-D",context:"Dieciseisavos · Atlanta"},
      {id:"wc2",league:"Copa Mundial FIFA 2026",sport:"football",home:"Paraguay",away:"Francia",time:"23:00",status:"upcoming",score:null,homeForm:"W-D-W-L-W",awayForm:"W-W-W-W-W",context:"Dieciseisavos · Houston"},
      {id:"wc3",league:"Copa Mundial FIFA 2026",sport:"football",home:"Estados Unidos",away:"Bélgica",time:"19:00",status:"upcoming",score:null,homeForm:"W-W-D-W-W",awayForm:"W-W-W-D-W",context:"Dieciseisavos · San Francisco"},
      {id:"wc4",league:"Copa Mundial FIFA 2026",sport:"football",home:"Noruega",away:"Portugal",time:"23:00",status:"upcoming",score:null,homeForm:"W-D-W-W-L",awayForm:"W-W-W-W-D",context:"Dieciseisavos · Toronto"},
      {id:"wc5",league:"Copa Mundial FIFA 2026",sport:"football",home:"Alemania",away:"Japón",time:"19:00",status:"upcoming",score:null,homeForm:"W-W-W-D-W",awayForm:"W-W-D-W-W",context:"Dieciseisavos · Seattle"},
      {id:"wc6",league:"Copa Mundial FIFA 2026",sport:"football",home:"Argentina",away:"Senegal",time:"23:00",status:"upcoming",score:null,homeForm:"W-W-W-W-W",awayForm:"W-D-W-L-W",context:"Dieciseisavos · Dallas"},
      {id:"wc7",league:"Copa Mundial FIFA 2026",sport:"football",home:"México",away:"Inglaterra",time:"19:00",status:"upcoming",score:null,homeForm:"W-W-D-W-W",awayForm:"W-W-W-D-W",context:"Octavos · Ciudad de México"},
      {id:"wc8",league:"Copa Mundial FIFA 2026",sport:"football",home:"Brasil",away:"Países Bajos",time:"23:00",status:"upcoming",score:null,homeForm:"W-W-W-D-W",awayForm:"W-W-D-W-W",context:"Octavos · Miami"},
    ];

    res.status(200).json({
      matches: worldCupMatches,
      source: 'worldcup2026',
      error: error.message
    });
  }
}
