import { verifyRegistrationResponse, verifyAuthenticationResponse } from '@simplewebauthn/server';
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from '@simplewebauthn/server';
export type PasskeyInput = {
  operation: 'passkey-register' | 'passkey-authenticate';
  response: RegistrationResponseJSON | AuthenticationResponseJSON;
  challenge: string;
  origin: string;
  credential?: { id: string; publicKey: string; counter: number };
};
export async function verifyPasskey(input: PasskeyInput) {
  const common = {
    expectedChallenge: input.challenge,
    expectedOrigin: input.origin,
    expectedRPID: new URL(input.origin).hostname,
    requireUserVerification: true,
  };
  if (input.operation === 'passkey-register') {
    const result = await verifyRegistrationResponse({
      ...common,
      response: input.response as RegistrationResponseJSON,
      supportedAlgorithmIDs: [-7, -257],
    });
    if (!result.verified) throw new Error('Invalid passkey');
    const c = result.registrationInfo.credential;
    return {
      id: c.id,
      publicKey: btoa(String.fromCharCode(...c.publicKey)),
      counter: c.counter,
      transports: c.transports || [],
    };
  }
  if (!input.credential) throw new Error('Missing credential');
  const result = await verifyAuthenticationResponse({
    ...common,
    response: input.response as AuthenticationResponseJSON,
    credential: {
      ...input.credential,
      publicKey: Uint8Array.from(atob(input.credential.publicKey), (c) => c.charCodeAt(0)),
    },
  });
  if (!result.verified) throw new Error('Invalid passkey');
  return { counter: result.authenticationInfo.newCounter };
}
