import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  FileText, 
  Settings, 
  Activity as ActivityIcon,
  BarChart3,
  Files,
} from 'lucide-react';

interface NavItem {
  label: string;
  icon: React.ReactNode;
  path: string;
}

const MobileBottomNav: React.FC = () => {
  const location = useLocation();
  
  const navItems: NavItem[] = [
    { label: 'Dashboard', icon: <LayoutDashboard size={24} />, path: '/dashboard' },
    { label: 'Proposals', icon: <FileText size={24} />, path: '/dashboard/proposals' },
    { label: 'Activity', icon: <ActivityIcon size={24} />, path: '/dashboard/activity' },
    { label: 'Analytics', icon: <BarChart3 size={24} />, path: '/dashboard/analytics' },
    { label: 'Settings', icon: <Settings size={24} />, path: '/dashboard/settings' },
  ];

  return (
    <nav 
      className="fixed bottom-0 left-0 right-0 md:hidden bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 safe-area-padding z-40"
      role="navigation"
      aria-label="Mobile navigation"
    >
      <div className="flex justify-around items-center h-16">
        {navItems.map((item) => {
          const isActive = location.pathname.includes(item.path);
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex flex-col items-center justify-center h-full w-full touch-target theme-transition ${
                isActive
                  ? 'text-purple-500 dark:text-purple-400'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-300'
              }`}
              aria-label={item.label}
              title={item.label}
            >
              {item.icon}
              <span className="text-xs mt-1 hidden sm:inline">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
};

export default MobileBottomNav;
