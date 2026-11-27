const CORS_PROXY = 'https://corsproxy.io/?';

export type RobloxVerificationOutcome =
  | {
      status: 'verified';
      userId: number;
      username: string;
    }
  | {
      status: 'not_joined';
      userId: number;
      username: string;
    }
  | {
      status: 'user_not_found';
      message: string;
    }
  | {
      status: 'network_error';
      message: string;
    };

function proxiedUrl(targetUrl: string): string {
  return `${CORS_PROXY}${encodeURIComponent(targetUrl)}`;
}

export async function fetchRobloxUserByUsername(
  rawUsername: string
): Promise<{ userId: number; username: string } | 'not_found' | 'network_error'> {
  const cleanUsername = rawUsername.trim();
  if (!cleanUsername) return 'not_found';

  try {
    const response = await fetch(
      proxiedUrl('https://users.roblox.com/v1/usernames/users'),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          usernames: [cleanUsername],
          excludeBannedUsers: true,
        }),
      }
    );

    if (!response.ok) {
      return 'network_error';
    }

    const payload = (await response.json()) as {
      data?: Array<{ id?: number; name?: string; displayName?: string }>;
    };

    const user = payload?.data?.[0];
    if (!user || typeof user.id !== 'number') {
      return 'not_found';
    }

    return {
      userId: user.id,
      username: user.name || cleanUsername,
    };
  } catch {
    return 'network_error';
  }
}

export async function checkUserInRobloxGroup(
  userId: number,
  targetGroupId: number
): Promise<'joined' | 'not_joined' | 'network_error'> {
  try {
    const response = await fetch(
      proxiedUrl(`https://groups.roblox.com/v1/users/${userId}/groups/roles?_cb=${Date.now()}`),
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'Cache-Control': 'no-cache',
        },
        cache: 'no-store',
      }
    );

    if (!response.ok) {
      return 'network_error';
    }

    const payload = (await response.json()) as {
      data?: Array<{ group?: { id?: number; name?: string } }>;
    };

    if (!payload || !Array.isArray(payload.data)) {
      return 'network_error';
    }

    const list = payload.data;
    const isMember = list.some(
      (entry) => Number(entry?.group?.id) === Number(targetGroupId)
    );

    return isMember ? 'joined' : 'not_joined';
  } catch {
    return 'network_error';
  }
}

export async function verifyRobloxMembership(
  rawUsername: string,
  targetGroupId: number,
  knownUserId?: number | null
): Promise<RobloxVerificationOutcome> {
  const trimmed = rawUsername.trim();
  if (!trimmed) {
    return {
      status: 'user_not_found',
      message: 'Please enter a valid Roblox username.',
    };
  }

  // Try direct server-side verification first (avoids browser CORS issues)
  try {
    const apiRes = await fetch('/api/roblox/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
      cache: 'no-store',
      body: JSON.stringify({
        username: trimmed,
        groupId: targetGroupId,
        knownUserId: knownUserId ?? null,
      }),
    });
    if (apiRes.ok) {
      const outcome = (await apiRes.json()) as RobloxVerificationOutcome;
      if (outcome && outcome.status !== 'network_error') {
        return outcome;
      }
    }
  } catch {
    // Fall through to client-side proxy fallback
  }

  let userId = knownUserId ?? null;
  let canonicalUsername = trimmed;

  if (!userId) {
    const userResult = await fetchRobloxUserByUsername(canonicalUsername);
    if (userResult === 'not_found') {
      return {
        status: 'user_not_found',
        message:
          'Roblox username not found. Please check your spelling and try again.',
      };
    }
    if (userResult === 'network_error') {
      return {
        status: 'network_error',
        message:
          'Unable to reach Roblox API right now. Please check your connection and try again.',
      };
    }
    userId = userResult.userId;
    canonicalUsername = userResult.username;
  }

  const groupCheck = await checkUserInRobloxGroup(userId, targetGroupId);
  if (groupCheck === 'network_error') {
    return {
      status: 'network_error',
      message:
        'Unable to verify group roles with Roblox API right now. Please try again.',
    };
  }

  if (groupCheck === 'not_joined') {
    return {
      status: 'not_joined',
      userId,
      username: canonicalUsername,
    };
  }

  return {
    status: 'verified',
    userId,
    username: canonicalUsername,
  };
}
