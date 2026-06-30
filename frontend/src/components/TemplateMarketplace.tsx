import React, { useState, useEffect } from 'react';
import { Download, Upload, Star, Eye } from 'lucide-react';
import { env } from '../config/env';

import type { VaultTemplate } from '../utils/vaultTemplates';

interface Template {
  id: string;
  name: string;
  description: string;
  rating: number;
}

interface TemplateMarketplaceProps {
  onSelectTemplate?: (template: VaultTemplate) => void;
  onClose?: () => void;
}

export function TemplateMarketplace({ onSelectTemplate, onClose }: TemplateMarketplaceProps) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [ratings, setRatings] = useState<Record<string, number>>(
    JSON.parse(localStorage.getItem('templateRatings') || '{}')
  );

  useEffect(() => {
    // Mock fetch from community source
    setTemplates([
      { id: '1', name: 'Standard Transfer', description: 'Basic token transfer template', rating: 4 },
      { id: '2', name: 'Mint Tokens', description: 'Template for minting new tokens', rating: 5 },
    ]);
  }, []);

  const handleRate = (id: string, stars: number) => {
    const newRatings = { ...ratings, [id]: stars };
    setRatings(newRatings);
    localStorage.setItem('templateRatings', JSON.stringify(newRatings));
  };

  const handleExport = (template: Template) => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(template, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `${template.name}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const handleImport = (template: Template) => {
    if (onSelectTemplate) {
      onSelectTemplate({
        id: template.id,
        name: template.name,
        description: template.description,
        category: 'Custom',
        icon: '📄',
        config: {
          signers: [],
          threshold: 2,
          spendingLimit: '10000000000',
          dailyLimit: '50000000000',
          weeklyLimit: '200000000000',
          timelockThreshold: '20000000000',
          timelockDelay: 17280,
        },
        features: [],
        recommended: false,
      });
      onClose?.();
      return;
    }
    console.log('Import to vault / governance proposal trigger for', template.name);
    alert(`Proposal created to import ${template.name}`);
  };

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold text-white">Community Templates</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {templates.map((t) => (
          <div key={t.id} className="bg-gray-800 p-4 rounded-xl border border-gray-700">
            <h3 className="text-lg font-bold text-white">{t.name}</h3>
            <p className="text-sm text-gray-400 mb-4">{t.description}</p>
            
            <div className="flex items-center gap-1 mb-4">
              {[1, 2, 3, 4, 5].map((star) => (
                <button key={star} onClick={() => handleRate(t.id, star)}>
                  <Star size={16} className={(ratings[t.id] || t.rating) >= star ? "text-yellow-400" : "text-gray-600"} />
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              <button onClick={() => handleImport(t)} className="flex items-center gap-1 px-3 py-1.5 bg-purple-600 text-white rounded text-sm hover:bg-purple-700">
                <Upload size={14} /> Import to Vault
              </button>
              <button onClick={() => handleExport(t)} className="flex items-center gap-1 px-3 py-1.5 bg-gray-700 text-white rounded text-sm hover:bg-gray-600">
                <Download size={14} /> Export
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default TemplateMarketplace;
