import React, { useState, useEffect } from 'react';
import { Bookmark, Trash2, Search } from 'lucide-react';
import { getSavedSearches, deleteSavedSearch, type SavedSearch } from '../utils/search';

export interface SavedSearchesProps {
  onSelect: (query: string, filters: Record<string, unknown>) => void;
  className?: string;
}

const SavedSearches: React.FC<SavedSearchesProps> = ({ onSelect, className = '' }) => {
  const [saved, setSaved] = useState<SavedSearch[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSaved(getSavedSearches());
  }, [open]);

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    deleteSavedSearch(id);
    setSaved(getSavedSearches());
  };

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm text-white border border-gray-600 min-h-[44px] sm:min-h-[36px]"
        aria-expanded={open}
      >
        <Bookmark size={18} />
        <span>Saved</span>
        {saved.length > 0 && (
          <span className="text-gray-400 text-xs">({saved.length})</span>
        )}
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            aria-hidden
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 mt-2 w-full min-w-[260px] max-w-[90vw] sm:max-w-sm bg-gray-800 border border-gray-600 rounded-xl shadow-xl z-20 overflow-hidden">
            <div className="p-3 border-b border-gray-700">
              <h3 className="text-sm font-medium text-white">Saved searches</h3>
            </div>
            <ul className="max-h-[280px] overflow-y-auto">
              {saved.length === 0 ? (
                <li className="p-4 text-center text-gray-500 text-sm">
                  No saved searches. Save a search from the search bar.
                </li>
              ) : (
                saved.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center gap-2 p-3 hover:bg-gray-700/50 border-b border-gray-700/50 last:border-0 group"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(item.query, item.filters);
                        setOpen(false);
                      }}
                      className="flex-1 min-w-0 flex items-center gap-2 text-left"
                    >
                      <Search size={16} className="text-gray-500 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white truncate">{item.name}</p>
                        {item.query && (
                          <p className="text-xs text-gray-400 truncate">&quot;{item.query}&quot;</p>
                        )}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => handleDelete(e, item.id)}
                      className="p-1.5 text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                      aria-label="Delete saved search"
                    >
                      <Trash2 size={16} />
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </>
      )}
    </div>
  );
};

export default SavedSearches;
