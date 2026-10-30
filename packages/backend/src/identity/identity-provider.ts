/** Provider identity is mapped to a separate permanent Merkat ID by the product domain. */
export interface VerifiedExternalIdentity {
  readonly issuer: string;
  readonly subject: string;
}

/**
 * Server-only verification boundary. No implementation or authentication fallback exists.
 * A future adapter must verify signature, issuer, audience, expiry and flow bindings
 * before returning a subject. OTP/OIDC initiation and recovery contracts are deferred
 * until provider selection; do not treat this as a complete authentication protocol.
 */
export interface IdentityProvider {
  verifyCredential(credential: string): Promise<VerifiedExternalIdentity>;
}
