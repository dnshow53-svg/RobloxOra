export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ status: 'network_error', message: 'Method not allowed' });
    return;
  }

  let rawBody = req.body;
  if (typeof rawBody === 'string' && rawBody.trim()) {
    try {
      rawBody = JSON.parse(rawBody);
    } catch {
      rawBody = {};
    }
  }
  const body = rawBody && typeof rawBody === 'object' ? rawBody : {};
  const cleanUsername = String(body.username || '').trim();
  const targetGroupId = Number(body.groupId);

  if (!cleanUsername || !targetGroupId) {
    res.status(400).json({ status: 'network_error', message: 'Missing username or groupId' });
    return;
  }

  try {
    let userId = typeof body.knownUserId === 'number' ? body.knownUserId : null;
    let canonicalUsername = cleanUsername;

    if (!userId) {
      const userRes = await fetch('https://users.roblox.com/v1/usernames/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Cache-Control': 'no-cache, no-store',
          'User-Agent': 'RobuxOra-Verifier/1.0',
        },
        body: JSON.stringify({ usernames: [cleanUsername], excludeBannedUsers: true }),
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      });

      if (!userRes.ok) {
        res.json({
          status: 'network_error',
          message: 'Unable to reach Roblox API right now.',
        });
        return;
      }

      const userJson = await userRes.json();
      const found = userJson?.data?.[0];
      if (!found || typeof found.id !== 'number') {
        res.json({
          status: 'user_not_found',
          message: 'Roblox username not found. Please check your spelling and try again.',
        });
        return;
      }

      userId = found.id;
      canonicalUsername = found.name || cleanUsername;
    }

    const groupsRes = await fetch(
      `https://groups.roblox.com/v1/users/${userId}/groups/roles?_cb=${Date.now()}`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'Cache-Control': 'no-cache, no-store',
          Pragma: 'no-cache',
          'User-Agent': 'RobuxOra-Verifier/1.0',
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      }
    );

    if (!groupsRes.ok) {
      res.json({
        status: 'network_error',
        message: 'Unable to check Roblox groups right now.',
      });
      return;
    }

    const groupsJson = await groupsRes.json();
    const list = Array.isArray(groupsJson?.data) ? groupsJson.data : [];
    const joined = list.some((item) => Number(item?.group?.id) === targetGroupId);

    if (!joined) {
      res.json({ status: 'not_joined', userId, username: canonicalUsername });
      return;
    }

    res.json({ status: 'verified', userId, username: canonicalUsername });
  } catch {
    res.json({
      status: 'network_error',
      message: 'Network error while reaching Roblox API.',
    });
  }
}
