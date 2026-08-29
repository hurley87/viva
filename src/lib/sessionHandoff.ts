// Handing the freshly minted client secret from the Student page to the
// Session screen.
//
// The secret is a live credential for the Examiner call, so it is kept in
// module memory for the one navigation that needs it and read exactly once.
// It is deliberately NOT put in the URL, `sessionStorage`, or a cookie: it
// would outlive its 120-second life in somebody's browser history or disk,
// and a Session cannot be resumed anyway — a Session that was minted but
// never connected is closed out by the server's time-box backstop and does
// not count against the Student's caps.

const pending = new Map<string, string>();

/** Hold the client secret for the Session screen that is about to mount. */
export function stashClientSecret(sessionId: string, clientSecret: string) {
  pending.set(sessionId, clientSecret);
}

/**
 * Take the client secret for a Session, removing it. Returns `null` when
 * there is none — a hard refresh, a pasted link, or a second attempt to
 * connect — which the Session screen renders as "this Session cannot be
 * resumed".
 */
export function takeClientSecret(sessionId: string): string | null {
  const secret = pending.get(sessionId);
  if (secret === undefined) {
    return null;
  }
  pending.delete(sessionId);
  return secret;
}
