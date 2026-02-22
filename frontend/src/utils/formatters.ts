export const truncateAddress = (address: string, left = 6, right = 4): string => {
  if (!address) return '-';
  if (address.length <= left + right) return address;
  return `${address.slice(0, left)}...${address.slice(-right)}`;
};

export const formatTokenAmount = (amount: bigint | number | string): string => {
  const parsed = BigInt(String(amount ?? 0));
  const whole = parsed / 10_000_000n;
  const fraction = parsed % 10_000_000n;

  if (fraction === 0n) {
    return `${whole.toString()} XLM`;
  }

  const fractionText = fraction.toString().padStart(7, '0').replace(/0+$/, '');
  return `${whole.toString()}.${fractionText} XLM`;
};

export const formatLedger = (ledger: number): string => {
  if (!ledger || Number.isNaN(ledger)) return '-';
  return `#${ledger.toLocaleString()}`;
};
