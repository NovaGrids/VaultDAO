import React, { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Calendar, DollarSign, TrendingUp } from 'lucide-react';
import type { RecurringPayment } from '../../hooks/useVaultContract';

const LEDGER_CLOSE_TIME_SECONDS = 5;
const MS_PER_DAY = 86_400_000;
const DAYS_IN_WEEK = 7;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const RECIPIENT_COLORS = [
  'bg-purple-500',
  'bg-blue-500',
  'bg-green-500',
  'bg-amber-500',
  'bg-pink-500',
  'bg-cyan-500',
  'bg-red-500',
  'bg-indigo-500',
];

function getRecipientColor(recipient: string): string {
  let hash = 0;
  for (let i = 0; i < recipient.length; i++) {
    hash = (hash * 31 + recipient.charCodeAt(i)) >>> 0;
  }
  return RECIPIENT_COLORS[hash % RECIPIENT_COLORS.length];
}

export function ledgerToDate(ledgerNumber: number): Date {
  if (!ledgerNumber || ledgerNumber < 0) return new Date();
  const GENESIS_TIMESTAMP = 1436387400000;
  return new Date(GENESIS_TIMESTAMP + ledgerNumber * LEDGER_CLOSE_TIME_SECONDS * 1000);
}

function formatAmount(stroops: string): string {
  const xlm = Number(stroops) / 10_000_000;
  return xlm.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 7 });
}

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

interface RecurringPaymentCalendarProps {
  payments: RecurringPayment[];
}

const RecurringPaymentCalendar: React.FC<RecurringPaymentCalendarProps> = ({ payments }) => {
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth();

  const calendarDays = useMemo(() => {
    const firstOfMonth = new Date(currentYear, currentMonth, 1);
    const startDayOfWeek = firstOfMonth.getDay();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

    const prevMonthDays: Date[] = [];
    const prevMonthEnd = new Date(currentYear, currentMonth, 0);
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      prevMonthDays.push(new Date(currentYear, currentMonth - 1, prevMonthEnd.getDate() - i));
    }

    const currentMonthDays: Date[] = [];
    for (let i = 1; i <= daysInMonth; i++) {
      currentMonthDays.push(new Date(currentYear, currentMonth, i));
    }

    const totalCells = Math.ceil((prevMonthDays.length + currentMonthDays.length) / 7) * 7;
    const nextMonthDays: Date[] = [];
    let nextDayCount = 1;
    while (prevMonthDays.length + currentMonthDays.length + nextMonthDays.length < totalCells) {
      nextMonthDays.push(new Date(currentYear, currentMonth + 1, nextDayCount));
      nextDayCount++;
    }

    return [...prevMonthDays, ...currentMonthDays, ...nextMonthDays];
  }, [currentYear, currentMonth]);

  const paymentsByDate = useMemo(() => {
    const map = new Map<string, RecurringPayment[]>();
    for (const p of payments) {
      const key = dayKey(new Date(p.nextPaymentTime));
      const existing = map.get(key);
      if (existing) {
        existing.push(p);
      } else {
        map.set(key, [p]);
      }
    }
    return map;
  }, [payments]);

  const next30DaysSummary = useMemo(() => {
    const now = Date.now();
    const thirtyDaysMs = 30 * MS_PER_DAY;
    const upcoming = payments.filter((p) => {
      const t = p.nextPaymentTime;
      return t >= now && t <= now + thirtyDaysMs;
    });

    const totalOutflow = upcoming.reduce((sum, p) => sum + Number(p.amount), 0);
    const mostExpensive = upcoming.length > 0
      ? upcoming.reduce((max, p) => (Number(p.amount) > Number(max.amount) ? p : max))
      : null;

    return { totalOutflow, mostExpensive, count: upcoming.length };
  }, [payments]);

  const selectedDatePayments = useMemo(() => {
    if (!selectedDate) return [];
    return paymentsByDate.get(dayKey(selectedDate)) ?? [];
  }, [selectedDate, paymentsByDate]);

  const goToPrevMonth = () => {
    setCurrentDate(new Date(currentYear, currentMonth - 1, 1));
    setSelectedDate(null);
  };

  const goToNextMonth = () => {
    setCurrentDate(new Date(currentYear, currentMonth + 1, 1));
    setSelectedDate(null);
  };

  const handleDayClick = (day: Date) => {
    setSelectedDate(day);
  };

  const today = new Date();
  const isToday = (d: Date) =>
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();

  const isCurrentMonth = (d: Date) => d.getMonth() === currentMonth;

  return (
    <div className="space-y-6">
      <div className="bg-gray-900/95 backdrop-blur-md border border-gray-700 rounded-xl shadow-2xl p-4 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={goToPrevMonth}
            className="p-2 hover:bg-gray-800 rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Previous month"
          >
            <ChevronLeft className="w-5 h-5 text-gray-400" />
          </button>
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-purple-400" />
            <h3 className="text-white font-semibold text-lg">
              {MONTH_NAMES[currentMonth]} {currentYear}
            </h3>
          </div>
          <button
            onClick={goToNextMonth}
            className="p-2 hover:bg-gray-800 rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Next month"
          >
            <ChevronRight className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1 mb-2">
          {WEEKDAY_LABELS.map((label) => (
            <div key={label} className="text-center text-xs text-gray-500 font-medium py-2">
              {label}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {calendarDays.map((day, idx) => {
            const dayPayments = paymentsByDate.get(dayKey(day)) ?? [];
            const hasPayments = dayPayments.length > 0;
            const selected = selectedDate && dayKey(day) === dayKey(selectedDate);

            return (
              <button
                key={idx}
                onClick={() => handleDayClick(day)}
                className={`
                  relative aspect-square flex flex-col items-center justify-center rounded-lg text-sm transition-all min-h-[44px]
                  ${isCurrentMonth(day) ? 'text-white' : 'text-gray-600'}
                  ${isToday(day) ? 'ring-2 ring-purple-500' : ''}
                  ${selected ? 'bg-purple-600/30 border border-purple-500' : 'hover:bg-gray-800/50'}
                `}
                aria-label={`${day.getDate()} ${MONTH_NAMES[day.getMonth()]}${hasPayments ? `, ${dayPayments.length} payment${dayPayments.length > 1 ? 's' : ''} due` : ''}`}
              >
                <span className="text-xs sm:text-sm">{day.getDate()}</span>
                {hasPayments && (
                  <div className="flex gap-0.5 mt-0.5">
                    {dayPayments.slice(0, 3).map((p, i) => (
                      <span
                        key={i}
                        className={`w-1.5 h-1.5 rounded-full ${getRecipientColor(p.recipient)}`}
                      />
                    ))}
                    {dayPayments.length > 3 && (
                      <span className="text-[8px] text-gray-400">+{dayPayments.length - 3}</span>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="bg-gray-900/95 backdrop-blur-md border border-gray-700 rounded-xl shadow-2xl p-4 sm:p-6">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="w-5 h-5 text-purple-400" />
          <h3 className="text-white font-semibold">Next 30 Days Summary</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-gray-800/50 rounded-lg p-4">
            <p className="text-xs text-gray-400 mb-1">Payments Due</p>
            <p className="text-2xl font-bold text-white">{next30DaysSummary.count}</p>
          </div>
          <div className="bg-gray-800/50 rounded-lg p-4">
            <p className="text-xs text-gray-400 mb-1">Total Outflow</p>
            <p className="text-2xl font-bold text-white">
              {formatAmount(String(next30DaysSummary.totalOutflow))} XLM
            </p>
          </div>
          <div className="bg-gray-800/50 rounded-lg p-4">
            <p className="text-xs text-gray-400 mb-1">Largest Single Payment</p>
            <p className="text-2xl font-bold text-white">
              {next30DaysSummary.mostExpensive
                ? formatAmount(next30DaysSummary.mostExpensive.amount) + ' XLM'
                : '—'}
            </p>
          </div>
        </div>
      </div>

      {selectedDate && (
        <div className="bg-gray-900/95 backdrop-blur-md border border-gray-700 rounded-xl shadow-2xl p-4 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-purple-400" />
              <h3 className="text-white font-semibold">
                Payments Due — {selectedDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
              </h3>
            </div>
            <button
              onClick={() => setSelectedDate(null)}
              className="text-gray-400 hover:text-white text-sm"
            >
              Close
            </button>
          </div>
          {selectedDatePayments.length === 0 ? (
            <p className="text-gray-400 text-sm py-4">No payments due on this date.</p>
          ) : (
            <div className="space-y-3">
              {selectedDatePayments.map((p) => (
                <div
                  key={p.id}
                  className="bg-gray-800/50 border border-gray-700 rounded-lg p-4"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-white font-medium">{p.memo || 'Untitled'}</span>
                    <span className="text-lg font-bold text-white">
                      {formatAmount(p.amount)} XLM
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <span className={`w-2 h-2 rounded-full ${getRecipientColor(p.recipient)}`} />
                    <span className="truncate">{p.recipient}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default RecurringPaymentCalendar;
