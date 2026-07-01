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

  try {
    // TheSportsDB - 100% free, no subscription needed
    const response = await fetch(
      `https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=${dateStr}&s=Soccer`,
      { method: 'GET' }
    );

    if (!response.ok) throw new Error(`API ${response.status}`);

    const data = await response.json();
    const events = data.events || [];
    if (!events.length) throw new Error('No events today');

    const matches = events.slice(0, 20).map((e, i) => {
      const timeRaw = e.strTime || '00:00:00';
      const time = timeRaw.substring(0, 5);
      const status = e.strStatus === 'Match Finished' ? 'finished'
        : (e.strStatus === 'In Progress' || e.intHomeScore !== null && e.strStatus !== 'Match Finished') ? 'live'
        : 'upcoming';
      const score = (e.intHomeScore !== null && e.intAwayScore !== null)
        ? `${e.intHomeScore}-${e.intAwayScore}` : null;

      return {
        id: String(e.idEvent || i),
        league: e.strLeague || 'Liga',
        sport: 'football',
        home: e.strHomeTeam || 'Local',
        away: e.strAwayTeam || 'Visitante',
        time,
        status,
        score,
        homeForm: 'W-D-W-L-W',
        awayForm: 'W-W-D-L-D',
        context: e.strSeason || e.intRound ? `Jornada ${e.intRound}` : ''
      };
    });

    res.status(200).json({ matches, source: 'live', total: events.length });

  } catch (error) {
    res.status(200).json({
      matches: [
        {id:"w1",league:"Copa Mundial FIFA 2026",sport:"football",home:"Uruguay",away:"Canadá",time:"12:00",status:"upcoming",score:null,homeForm:"W-W-D-W-W",awayForm:"D-W-W-L-D",context:"Grupo C"},
        {id:"w2",league:"Copa Mundial FIFA 2026",sport:"football",home:"Portugal",away:"Marruecos",time:"15:00",status:"upcoming",score:null,homeForm:"W-W-W-D-W",awayForm:"W-D-W-W-L",context:"Grupo H"},
        {id:"w3",league:"Copa Mundial FIFA 2026",sport:"football",home:"Francia",away:"México",time:"18:00",status:"upcoming",score:null,homeForm:"W-W-D-W-W",awayForm:"L-W-D-W-L",context:"Grupo E"},
        {id:"w4",league:"Copa Mundial FIFA 2026",sport:"football",home:"España",away:"Nigeria",time:"21:00",status:"upcoming",score:null,homeForm:"W-W-W-W-D",awayForm:"W-D-L-W-W",context:"Grupo B"},
        {id:"l1",league:"Copa Libertadores",sport:"football",home:"Flamengo",away:"Boca Juniors",time:"19:00",status:"upcoming",score:null,homeForm:"W-W-D-W-L",awayForm:"W-W-W-D-W",context:"Octavos"},
        {id:"b1",league:"Liga BetPlay",sport:"football",home:"Millonarios",away:"Atlético Nacional",time:"17:30",status:"upcoming",score:null,homeForm:"W-D-W-L-W",awayForm:"W-W-D-W-D",context:"Clásico"},
        {id:"n1",league:"NBA Finals 2026",sport:"basketball",home:"Boston Celtics",away:"OKC Thunder",time:"20:00",status:"upcoming",score:null,homeForm:"W-W-L-W-W",awayForm:"W-W-W-L-W",context:"Game 5"}
      ],
      source: 'fallback',
      error: error.message
    });
  }
}
