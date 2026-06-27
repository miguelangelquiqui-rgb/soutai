export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const today = new Date();
  const day = String(today.getDate()).padStart(2,'0');
  const month = String(today.getMonth()+1).padStart(2,'0');
  const year = today.getFullYear();
  // Format: DDMMYYYY (e.g. 26062026)
  const dateStr = `${day}${month}${year}`;

  try {
    const url = `https://free-api-live-football-data.p.rapidapi.com/football-get-matches-by-date?date=${dateStr}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'x-rapidapi-key': process.env.RAPIDAPI_KEY,
        'x-rapidapi-host': 'free-api-live-football-data.p.rapidapi.com'
      }
    });

    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch(e) { throw new Error('Parse error: ' + text.substring(0,100)); }

    if (!response.ok) throw new Error(`API ${response.status}: ${text.substring(0,100)}`);

    // Try different response structures
    const items = data?.response?.matches || data?.matches || data?.data || data?.results || [];
    
    if (!items.length) {
      throw new Error(`No matches. Keys: ${Object.keys(data?.response || data || {}).join(',')}`);
    }

    const matches = items.slice(0, 20).map((m, i) => {
      const timeRaw = m.time || '';
      const timeParts = timeRaw.split(' ');
      const timeOnly = timeParts.length > 1 ? timeParts[1] : timeRaw;

      let status = 'upcoming', score = null;
      const hs = m.home?.score ?? 0;
      const as_ = m.away?.score ?? 0;
      const st = (m.status || '').toLowerCase();
      if (st === 'live' || st === 'inprogress' || st === '1h' || st === '2h' || st === 'ht') {
        status = 'live';
        score = `${hs}-${as_}`;
      } else if (st === 'finished' || st === 'ft' || st === 'aet') {
        status = 'finished';
        score = `${hs}-${as_}`;
      }

      return {
        id: String(m.id || i),
        league: m.league?.name || m.leagueName || m.tournament || 'Liga',
        sport: 'football',
        home: m.home?.name || m.home?.longName || m.homeTeam || 'Local',
        away: m.away?.name || m.away?.longName || m.awayTeam || 'Visitante',
        time: timeOnly,
        status, score,
        homeForm: 'W-D-W-L-W',
        awayForm: 'W-W-D-L-D',
        context: m.round || m.roundName || m.league?.country || ''
      };
    });

    res.status(200).json({ matches, source: 'live', total: items.length, date: dateStr });

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
      error: error.message,
      date: dateStr
    });
  }
}
