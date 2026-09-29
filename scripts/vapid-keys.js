#!/usr/bin/env node
// PINGS: a new VAPID key pair for Web Push (pro/push.js), printed in .env format.
//
//   node scripts/vapid-keys.js >> .env
//
// Run it once per site and keep the pair: a new pair makes every browser's subscription
// useless, so everyone has to turn pings on again in ME. The private key is a secret:
// it goes in .env only, never in git.

import { generateKeyPairSync } from 'node:crypto';

// A P-256 pair as Web Push wants it: the public key uncompressed (65 bytes), the private
// key as its 32-byte scalar, both base64url without padding.
export function vapidKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pub = publicKey.export({ format: 'jwk' });
  const priv = privateKey.export({ format: 'jwk' });
  const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')]);
  return { publicKey: raw.toString('base64url'), privateKey: priv.d };
}

export function envLines({ publicKey, privateKey }, subject = 'mailto:hello@bloombroke.com') {
  return `VAPID_PUBLIC_KEY=${publicKey}\nVAPID_PRIVATE_KEY=${privateKey}\nVAPID_SUBJECT=${subject}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(envLines(vapidKeys()));
