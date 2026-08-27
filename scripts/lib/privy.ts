type PrivyUser = {
  id: string;
};

export type PrivyEnv = {
  appId: string;
  appSecret: string;
};

const API_HOST = "https://api.privy.io";
const AUTH_HOST = "https://auth.privy.io";

export function requirePrivyEnv(): PrivyEnv {
  const appId = process.env.PRIVY_APP_ID ?? process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!appId) {
    throw new Error("PRIVY_APP_ID (or NEXT_PUBLIC_PRIVY_APP_ID) is not set");
  }
  if (!appSecret) {
    throw new Error("PRIVY_APP_SECRET is not set");
  }
  return { appId, appSecret };
}

function headers(env: PrivyEnv): HeadersInit {
  const basic = Buffer.from(`${env.appId}:${env.appSecret}`).toString("base64");
  return {
    Authorization: `Basic ${basic}`,
    "Content-Type": "application/json",
    "privy-app-id": env.appId,
  };
}

async function readError(response: Response): Promise<string> {
  const text = await response.text();
  return text.length > 0 ? text : response.statusText;
}

export async function getUserByEmail(
  env: PrivyEnv,
  email: string,
): Promise<PrivyUser | null> {
  const response = await fetch(`${AUTH_HOST}/api/v1/users/email/address`, {
    method: "POST",
    headers: headers(env),
    body: JSON.stringify({ address: email }),
  });

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(
      `Privy get-by-email failed (${response.status}): ${await readError(response)}`,
    );
  }
  return (await response.json()) as PrivyUser;
}

export async function createUser(
  env: PrivyEnv,
  email: string,
): Promise<PrivyUser> {
  const response = await fetch(`${API_HOST}/v1/users`, {
    method: "POST",
    headers: headers(env),
    body: JSON.stringify({
      linked_accounts: [{ type: "email", address: email }],
    }),
  });

  if (response.ok) {
    return (await response.json()) as PrivyUser;
  }

  if (response.status === 409) {
    const existing = await getUserByEmail(env, email);
    if (existing) {
      return existing;
    }
  }

  throw new Error(
    `Privy create user failed (${response.status}): ${await readError(response)}`,
  );
}

export async function addEmailToAllowlist(
  env: PrivyEnv,
  email: string,
): Promise<void> {
  const response = await fetch(
    `${AUTH_HOST}/api/v1/apps/${env.appId}/allowlist`,
    {
      method: "POST",
      headers: headers(env),
      body: JSON.stringify({ type: "email", value: email }),
    },
  );

  if (response.ok || response.status === 409) {
    return;
  }

  throw new Error(
    `Privy allowlist add failed (${response.status}): ${await readError(response)}`,
  );
}

export async function removeEmailFromAllowlist(
  env: PrivyEnv,
  email: string,
): Promise<void> {
  const response = await fetch(
    `${AUTH_HOST}/api/v1/apps/${env.appId}/allowlist`,
    {
      method: "DELETE",
      headers: headers(env),
      body: JSON.stringify({ type: "email", value: email }),
    },
  );

  if (response.ok || response.status === 404) {
    return;
  }

  throw new Error(
    `Privy allowlist remove failed (${response.status}): ${await readError(response)}`,
  );
}

export async function deleteUser(
  env: PrivyEnv,
  privyDid: string,
): Promise<void> {
  const response = await fetch(`${API_HOST}/v1/users/${privyDid}`, {
    method: "DELETE",
    headers: headers(env),
  });

  if (response.ok || response.status === 204 || response.status === 404) {
    return;
  }

  throw new Error(
    `Privy delete user failed (${response.status}): ${await readError(response)}`,
  );
}
