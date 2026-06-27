export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const today = new Date().toISOString().split('T')[0];

  try {
    const response = await fetch(
      `https://sportapi7.p.rapidapi.com/api/v1/category/1/scheduled-events/${today}`,
      {
        method: 'GET',
        headers: {
          'x-rapidapi-key': process.env.RAPIDAPI_KEY,
          'x-rapidapi-host': 'sportapi7.p.rapidapi.com',
          'Content-Type': 'application/json'
        }
      }
    );

    if (!response.ok) throw new Error(`API ${response.status}`);

    const data = await response.json();
    const events = data.events || [];

    if (!events.length) throw new Error('No events');

    const topLeagues = [
      'premier league','laliga','la liga','bundesliga',
      'serie a','ligue 1','champions league','europa league',
      'copa libertadores','copa sudamericana','betplay',
      'world cup','copa mundial','mls','eredivisie'
    ];

    const filtered = events.filter(e => {
      const name = (e.tournament?.name || '').toLowerCase();
      return topLeagues.some(l => name.includes(l));
    }).slice(0, 20);

    const list = (filtered.length ? filtered : events.slice(0, 15)).map(e => {
      const date = new Date((e.startTimestamp || 0) * 1000);
      const time = date.toLocaleTimeString('es-CO', {
        hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota'
      });
      const st = e.status?.type;
      let status = 'upcoming', score = null;
      if (st === 'inprogress') {
        status = 'live';
        score = `${e.homeScore?.current ?? 0}-${e.awayScore?.current ?? 0}`;
      } else if (st === 'finished') {
        status = 'finished';
        score = `${e.homeScore?.current ?? 0}-${e.awayScore?.current ?? 0}`;
      }
      return {
        id: String(e.id),
        league: e.tournament?.name || 'Liga',
        sport: 'football',
        home: e.homeTeam?.name || 'Local',
        away: e.awayTeam?.name || 'Visitante',
        time, status, score,
        homeForm: 'W-D-W-L-W',
        awayForm: 'W-W-D-L-D',
        context: e.roundInfo?.name || e.tournament?.category?.name || ''
      };
    });

    res.status(200).json({ matches: list, source: 'live', total: events.length });

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
