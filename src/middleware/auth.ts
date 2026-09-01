import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../lib/env.js';

export type AuthPayload = {
  sub: string;
  service: string;
};

export type AuthedRequest = Request & { auth?: AuthPayload };

export function requireJwt(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Token ausente' });
    return;
  }
  const token = header.slice('Bearer '.length);
  try {
    const payload = jwt.verify(token, env.jwtSecret) as AuthPayload;
    req.auth = { sub: payload.sub, service: payload.service };
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
}

export function signJwt(payload: AuthPayload): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn } as jwt.SignOptions);
}

export function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const key = req.headers['x-api-key'];
  if (key !== env.apiServiceKey) {
    res.status(401).json({ error: 'API key inválida' });
    return;
  }
  next();
}
