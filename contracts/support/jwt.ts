// A well-formed but unsigned JWT for the consumer tests. supabase-js only
// decodes it (for `exp` and the user id); no verifier ever sees it, so the
// signature is a fixed marker. Never valid against any real project.

const b64url = (s: string) => Buffer.from(s).toString('base64url')

export function fakeJwt(claims: { sub: string; email: string; exp: number }): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64url(
    JSON.stringify({
      iss: 'contract-test',
      aud: 'authenticated',
      role: 'authenticated',
      session_id: 'contract-session',
      ...claims,
    }),
  )
  return `${header}.${payload}.contract-test-signature`
}
