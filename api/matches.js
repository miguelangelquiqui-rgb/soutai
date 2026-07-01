export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const LEAGUES = [
    'fifa.world','uefa.champions',
    'eng.1','esp.1','ger.1','ita.1','fra.1',
    'usa.1','mex.1',
    'conmebol.libertadores','conmebol.sudamericana',
    'col.1'
  ];

  const LEAGUE_NAMES = {
    'fifa.world': 'Copa Mundial FIFA 2026',
    'uefa.champions': 'UEFA Champions League',
    'eng.1': 'Premier League',
    'esp.1': 'La Liga',
    'ger.1': 'Bundesliga',
    'ita.1': 'Serie A',
    'fra.1': 'Ligue 1',
    'usa.1': 'MLS',
    'mex.1': 'Liga MX',
    'conmebol.libertadores': 'Copa Libertadores',
    'conmebol.sudamericana': 'Copa Sudamericana',
    'col.1': 'Liga BetPlay'
  };

  try {
    const today = new Date();
    const fetchJobs = [];

    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const dateStr = `${yyyy}${mm}${dd}`;
      const dateISO = `${yyyy}-${mm}-${dd}`;
      const dateLabel = i === 0 ? 'Hoy' : i === 1 ? 'Mañana' :
        d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'short' });

      for (const league of LEAGUES) {
        fetchJobs.push({ league, dateStr, dateISO, dateLabel });
      }
    }

    const results = await Promise.allSettled(
      fetchJobs.map(job => fetchLeague(job))
    );

    const allMatches = [];
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      for (const m of r.value) allMatches.push(m);
    }

    allMatches.sort((a, b) => {
      if (a.status === 'live' && b.status !== 'live') return -1;
      if (b.status === 'live' && a.status !== 'live') return 1;
      return (a.date + a.time).localeCompare(b.date + b.time);
    });

    if (allMatches.length > 0) {
      return res.status(200).json({ matches: allMatches, source: 'espn', total: allMatches.length });
    }
    throw new Error('No ESPN matches found');

  } catch (error) {
    return res.status(200).json({ matches: [], source: 'fallback', error: error.message, total: 0 });
  }

  async function fetchLeague({ league, dateStr, dateISO, dateLabel }) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    try {
      const r = await fetch(
        `https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/scoreboard?dates=${dateStr}`,
        { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: controller.signal }
      );
      clearTimeout(timeout);
      if (!r.ok) return [];
      const data = await r.json();
      const events = data.events || [];
      const parsed = [];

      for (const e of events) {
        const comp = e.competitions?.[0];
        if (!comp) continue;
        const home = comp.competitors?.find(c => c.homeAway === 'home');
        const away = comp.competitors?.find(c => c.homeAway === 'away');
        if (!home || !away) continue;

        const homeName = home.team?.displayName || '';
        const awayName = away.team?.displayName || '';
        if (!homeName || !awayName ||
          homeName.includes('Winner') || awayName.includes('Winner') ||
          homeName.includes('TBD') || awayName.includes('TBD') ||
          homeName.includes('Loser') || awayName.includes('Loser')) continue;

        const statusType = e.status?.type?.name || '';
        let status = 'upcoming', score = null;
        if (statusType.includes('PROGRESS') || statusType.includes('HALFTIME')) {
          status = 'live';
          score = `${home.score || 0}-${away.score || 0}`;
        } else if (statusType.includes('FINAL') || statusType.includes('FULL_TIME')) {
          status = 'finished';
          score = `${home.score || 0}-${away.score || 0}`;
        }

        let time = '—';
        if (e.date) {
          try {
            time = new Date(e.date).toLocaleTimeString('es-CO', {
              hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota'
            });
          } catch {}
        }

        parsed.push({
          id: String(e.id),
          league: LEAGUE_NAMES[league] || league,
          leagueSlug: league,
          sport: 'football',
          home: homeName,
          away: awayName,
          homeId: home.team?.id || '',
          awayId: away.team?.id || '',
          homeLogo: home.team?.logo || '',
          awayLogo: away.team?.logo || '',
          time, date: dateISO, dateLabel,
          status, score,
          homeRecord: home.records?.[0]?.summary || '',
          awayRecord: away.records?.[0]?.summary || '',
          context: comp.notes?.[0]?.headline || ''
        });
      }
      return parsed;
    } catch {
      clearTimeout(timeout);
      return [];
    }
  }
}
