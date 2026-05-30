import { PrivateKey } from "@hiero-ledger/sdk";

/**
 * Parse a Hedera private key from a DER (`302…`) or raw ECDSA hex string,
 * tolerating a leading `0x`.
 */
export function parsePrivateKey(privateKey: string): PrivateKey {
  const normalized = privateKey.startsWith("0x") ? privateKey.slice(2) : privateKey;
  return normalized.startsWith("302")
    ? PrivateKey.fromStringDer(normalized)
    : PrivateKey.fromStringECDSA(normalized);
}
