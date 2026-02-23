import React, { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface CalendarEvent {
  date: string;
  title: string;
  type: 'proposal' | 'payment' | 'meeting';
}

interface CalendarWidgetProps {
  title: string;
  events?: CalendarEvent[];
  onDateClick?: (date: Date) => void;
}

const CalendarWidget: React.FC<CalendarWidgetProps> = ({ title, events = [], onDateClick }) => {
  const [currentDate, setCurrentDate] = useState(new Date());

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();

    return { daysInMonth, startingDayOfWeek };
  };

  const { daysInMonth, startingDayOfWeek } = getDaysInMonth(currentDate);

  const prevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1));
  };

  const hasEvent = (day: number) => {
    const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return events.some(e => e.date === dateStr);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="p-1 hover:bg-gray-700 rounded">
            <ChevronLeft className="h-4 w-4 text-gray-400" />
          </button>
          <span className="text-xs text-gray-400">
            {currentDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
          </span>
          <button onClick={nextMonth} className="p-1 hover:bg-gray-700 rounded">
            <ChevronRight className="h-4 w-4 text-gray-400" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => (
          <div key={i} className="text-gray-500 font-medium py-1">{day}</div>
        ))}
        {Array.from({ length: startingDayOfWeek }).map((_, i) => (
          <div key={`empty-${i}`} />
        ))}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const isToday = day === new Date().getDate() && 
                         currentDate.getMonth() === new Date().getMonth() &&
                         currentDate.getFullYear() === new Date().getFullYear();
          return (
            <button
              key={day}
              onClick={() => onDateClick?.(new Date(currentDate.getFullYear(), currentDate.getMonth(), day))}
              className={`py-1 rounded hover:bg-gray-700 transition-colors ${
                isToday ? 'bg-purple-600 text-white' : 'text-gray-300'
              } ${hasEvent(day) ? 'font-bold' : ''}`}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default CalendarWidget;
