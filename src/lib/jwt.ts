import { SignJWT, jwtVerify } from 'jose'

export type JwtPayload = {
  tenantId: string
  email: string
}

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be set and be at least 32 characters long')
  }
  return new TextEncoder().encode(secret)
}

export async function signJwt(payload: JwtPayload): Promise<string> {
  return await new SignJWT({ tenantId: payload.tenantId, email: payload.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(getSecret())
}

export async function verifyJwt(token: string): Promise<JwtPayload> {
  const { payload } = await jwtVerify(token, getSecret())

  if (
    typeof payload.tenantId !== 'string' ||
    typeof payload.email !== 'string'
  ) {
    throw new Error('Invalid JWT payload shape')
  }

  return { tenantId: payload.tenantId, email: payload.email }
}
