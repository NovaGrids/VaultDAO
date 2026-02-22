import { StrKey } from 'stellar-sdk';

// Base32 alphabet used by Stellar
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// Validate base32 encoding
const isValidBase32 = (str: string): boolean => {
  for (const char of str) {
    if (!BASE32_ALPHABET.includes(char)) {
      return false;
    }
  }
  return true;
};

// Stellar address validation
export const isValidStellarAddress = (addr: string): boolean => {
  if (!addr || typeof addr !== 'string') return false;
  
  // Check for valid Ed25519 public key (G... format, 56 characters)
  if (addr.startsWith('G')) {
    if (addr.length !== 56) return false;
    try {
      return StrKey.isValidEd25519PublicKey(addr);
    } catch {
      return false;
    }
  }
  
  // Check for valid muxed account (M... format, 69 characters)
  if (addr.startsWith('M')) {
    if (addr.length !== 69) return false;
    // Validate base32 encoding for muxed accounts
    const dataPart = addr.slice(1);
    return isValidBase32(dataPart);
  }
  
  return false;
};

// Check if it's a valid contract address (C... format, 56 characters)
export const isValidContractAddress = (addr: string): boolean => {
  if (!addr || typeof addr !== 'string') return false;
  
  // Contract addresses start with C and are 56 characters
  if (addr.startsWith('C')) {
    if (addr.length !== 56) return false;
    // Validate base32 encoding
    const dataPart = addr.slice(1);
    return isValidBase32(dataPart);
  }
  
  // Also accept NATIVE as a valid token identifier
  if (addr === 'NATIVE') return true;
  
  // Also accept valid Stellar addresses as token addresses
  return isValidStellarAddress(addr);
};

// Format amount with proper decimal handling
export const formatAmount = (value: string): string => {
  // Remove any non-numeric characters except decimal point
  let cleaned = value.replace(/[^0-9.]/g, '');
  
  // Ensure only one decimal point
  const parts = cleaned.split('.');
  if (parts.length > 2) {
    cleaned = parts[0] + '.' + parts.slice(1).join('');
  }
  
  // Limit decimal places to 7 (Stellar's maximum precision)
  if (parts.length === 2 && parts[1].length > 7) {
    cleaned = parts[0] + '.' + parts[1].slice(0, 7);
  }
  
  return cleaned;
};

// Convert amount to stroops (smallest unit, 7 decimal places)
export const amountToStroops = (amount: string): string => {
  if (!amount || isNaN(parseFloat(amount))) return '0';
  
  const num = parseFloat(amount);
  // Multiply by 10^7 to convert to stroops
  const stroops = Math.floor(num * 10000000);
  return stroops.toString();
};
