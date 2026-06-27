export const formatAmount = (amount: number, locale: string = 'en') => {
  return new Intl.NumberFormat(locale, { style: 'decimal', maximumFractionDigits: 2 }).format(amount);
};

export const formatDate = (date: string | Date, locale: string = 'en') => {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(date));
};
