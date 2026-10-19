const LEASE_MS = 8000;

type Lease = { viewer: string; expires: number };

const globalLease = globalThis as typeof globalThis & { __openstateCaptureLease?: Lease };

export function claimLease(viewer: string) {
  const now = Date.now();
  const lease = globalLease.__openstateCaptureLease;
  if (!lease || lease.expires < now || lease.viewer === viewer) {
    globalLease.__openstateCaptureLease = { viewer, expires: now + LEASE_MS };
    return true;
  }
  return false;
}

export function holdsLease(viewer: string) {
  const lease = globalLease.__openstateCaptureLease;
  return Boolean(lease && lease.viewer === viewer && lease.expires >= Date.now());
}
