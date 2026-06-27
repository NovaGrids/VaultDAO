import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  localData: any;
  remoteData: any;
  onResolve: (data: any) => void;
}

const ConflictResolutionPanel: React.FC<Props> = ({ localData, remoteData, onResolve }) => {
  return (
    <div className="p-4 border border-red-500 bg-red-500/10 rounded-lg shadow-lg">
      <div className="flex items-center gap-2 mb-4">
        <AlertTriangle className="text-red-500" />
        <h3 className="text-red-500 font-bold">Conflict Detected</h3>
      </div>
      <p className="text-sm text-gray-300 mb-4">
        Another user edited these fields concurrently. Please choose which version to keep.
      </p>
      <div className="flex gap-4">
        <div className="flex-1 bg-gray-800 p-4 rounded-lg border border-gray-700">
          <h4 className="font-semibold text-gray-300 mb-2">Your Changes</h4>
          <div className="text-xs text-gray-400 bg-gray-900 p-3 rounded h-32 overflow-y-auto mb-3">
            {JSON.stringify(localData, null, 2)}
          </div>
          <button 
            onClick={() => onResolve(localData)} 
            className="w-full py-2 bg-blue-600 hover:bg-blue-700 transition-colors text-white rounded font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
          >
            Keep Mine
          </button>
        </div>
        <div className="flex-1 bg-gray-800 p-4 rounded-lg border border-gray-700">
          <h4 className="font-semibold text-gray-300 mb-2">Their Changes</h4>
          <div className="text-xs text-gray-400 bg-gray-900 p-3 rounded h-32 overflow-y-auto mb-3">
            {JSON.stringify(remoteData, null, 2)}
          </div>
          <button 
            onClick={() => onResolve(remoteData)} 
            className="w-full py-2 bg-purple-600 hover:bg-purple-700 transition-colors text-white rounded font-medium focus:ring-2 focus:ring-purple-500 focus:outline-none"
          >
            Keep Theirs
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConflictResolutionPanel;
