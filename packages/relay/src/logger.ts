import pino from 'pino';

export const log = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'kant-relay' },
  redact: [
    'req.headers.authorization',
    'req.body.sig',
    'req.body.nonce',
    'req.body.publicKeyHex',
    'req.socket.remoteAddress',
  ],
  timestamp: pino.stdTimeFunctions.isoTime,
});
