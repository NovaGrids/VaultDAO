import { useState } from 'react';
import { saveCustomTemplate, exportTemplate, type VaultTemplate } from '../utils/vaultTemplates';

interface VaultClonerProps {
    currentConfig: {
        signers: string[];
        threshold: number;
        spendingLimit: string;
        dailyLimit: string;
        weeklyLimit: string;
        timelockThreshold: string;
        timelockDelay: number;
    };
    onClone: (config: VaultTemplate['config'], signers: string[]) => Promise<string>;
    onClose: () => void;
}

export default function VaultCloner({ currentConfig, onClone, onClose }: VaultClonerProps) {
    const [signers, setSigners] = useState<string[]>(currentConfig.signers);
    const [config, setConfig] = useState(currentConfig);
    const [cloning, setCloning] = useState(false);
    const [clonedAddress, setClonedAddress] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [showSaveTemplate, setShowSaveTemplate] = useState(false);
    const [templateName, setTemplateName] = useState('');
    const [templateDescription, setTemplateDescription] = useState('');

    const addSigner = () => {
        setSigners([...signers, '']);
    };

    const removeSigner = (index: number) => {
        setSigners(signers.filter((_, i) => i !== index));
    };

    const updateSigner = (index: number, value: string) => {
        const newSigners = [...signers];
        newSigners[index] = value;
        setSigners(newSigners);
    };

    const handleClone = async () => {
        setError(null);
        setCloning(true);

        try {
            const validSigners = signers.filter((s) => s.trim().length > 0);

            if (validSigners.length === 0) {
                throw new Error('At least one signer is required');
            }

            if (config.threshold > validSigners.length) {
                throw new Error('Threshold cannot exceed number of signers');
            }

            const address = await onClone(config, validSigners);
            setClonedAddress(address);
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : 'Cloning failed';
            setError(errorMessage);
        } finally {
            setCloning(false);
        }
    };

    const handleSaveAsTemplate = () => {
        if (!templateName.trim()) {
            setError('Template name is required');
            return;
        }

        const template: VaultTemplate = {
            id: `custom-${Date.now()}`,
            name: templateName,
            description: templateDescription || 'Custom vault template',
            category: 'Custom',
            icon: '⚙️',
            config: {
                ...config,
                signers: signers.filter((s) => s.trim().length > 0),
            },
            features: [
                `${config.threshold} signatures required`,
                `Spending limit: ${(parseInt(config.spendingLimit) / 10000000).toLocaleString()} XLM`,
                `Daily limit: ${(parseInt(config.dailyLimit) / 10000000).toLocaleString()} XLM`,
            ],
            recommended: false,
        };

        saveCustomTemplate(template);
        setShowSaveTemplate(false);
        setError(null);
        alert('Template saved successfully!');
    };

    const handleExportTemplate = () => {
        const template: VaultTemplate = {
            id: `export-${Date.now()}`,
            name: 'Exported Vault Configuration',
            description: 'Exported from existing vault',
            category: 'Custom',
            icon: '📤',
            config: {
                ...config,
                signers: signers.filter((s) => s.trim().length > 0),
            },
            features: [],
            recommended: false,
        };

        const json = exportTemplate(template);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'vault-template.json';
        a.click();
        URL.revokeObjectURL(url);
    };

    const stroopsToXLM = (stroops: string) => {
        return (parseInt(stroops, 10) / 10000000).toLocaleString();
    };

    if (clonedAddress) {
        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
                <div className="w-full max-w-2xl rounded-xl border border-gray-700 bg-gray-900 p-6">
                    <div className="text-center">
                        <div className="mb-4 flex justify-center">
                            <div className="rounded-full bg-green-500/20 p-4">
                                <svg className="w-12 h-12 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                            </div>
                        </div>
                        <h2 className="text-2xl font-bold text-white mb-2">Vault Cloned Successfully!</h2>
                        <p className="text-gray-400 mb-6">Your new vault is ready to use</p>

                        <div className="bg-gray-800 rounded-lg p-4 mb-6">
                            <p className="text-sm text-gray-400 mb-2">New Vault Address:</p>
                            <p className="font-mono text-white break-all">{clonedAddress}</p>
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={onClose}
                                className="flex-1 min-h-[44px] px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors"
                            >
                                Close
                            </button>
                            <button
                                onClick={() => navigator.clipboard.writeText(clonedAddress)}
                                className="flex-1 min-h-[44px] px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                            >
                                Copy Address
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (showSaveTemplate) {
        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
                <div className="w-full max-w-2xl rounded-xl border border-gray-700 bg-gray-900 p-6">
                    <h2 className="text-2xl font-bold text-white mb-4">Save as Template</h2>

                    <div className="space-y-4 mb-6">
                        <div>
                            <label className="block text-sm font-medium text-gray-400 mb-2">
                                Template Name
                            </label>
                            <input
                                type="text"
                                value={templateName}
                                onChange={(e) => setTemplateName(e.target.value)}
                                placeholder="My Custom Template"
                                className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-400 mb-2">
                                Description
                            </label>
                            <textarea
                                value={templateDescription}
                                onChange={(e) => setTemplateDescription(e.target.value)}
                                placeholder="Describe this template..."
                                rows={3}
                                className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
                            />
                        </div>
                    </div>

                    {error && (
                        <div className="mb-4 p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400">
                            {error}
                        </div>
                    )}

                    <div className="flex gap-3">
                        <button
                            onClick={() => setShowSaveTemplate(false)}
                            className="flex-1 min-h-[44px] px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSaveAsTemplate}
                            className="flex-1 min-h-[44px] px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                        >
                            Save Template
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-4xl max-h-[90vh] rounded-xl border border-gray-700 bg-gray-900 overflow-hidden flex flex-col">
                {/* Header */}
                <div className="p-6 border-b border-gray-700">
                    <div className="flex items-center justify-between">
                        <h2 className="text-2xl font-bold text-white">Clone Vault</h2>
                        <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                    <p className="text-gray-400 mt-2">
                        Clone this vault's configuration and modify settings for the new vault
                    </p>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {error && (
                        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400">
                            {error}
                        </div>
                    )}

                    {/* Current Configuration Preview */}
                    <div className="bg-gray-800/50 rounded-lg p-4">
                        <h3 className="text-lg font-semibold text-white mb-3">Current Configuration</h3>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                                <p className="text-gray-400">Threshold</p>
                                <p className="text-white font-semibold">{currentConfig.threshold} signatures</p>
                            </div>
                            <div>
                                <p className="text-gray-400">Signers</p>
                                <p className="text-white font-semibold">{currentConfig.signers.length}</p>
                            </div>
                            <div>
                                <p className="text-gray-400">Spending Limit</p>
                                <p className="text-white font-semibold">{stroopsToXLM(currentConfig.spendingLimit)} XLM</p>
                            </div>
                            <div>
                                <p className="text-gray-400">Daily Limit</p>
                                <p className="text-white font-semibold">{stroopsToXLM(currentConfig.dailyLimit)} XLM</p>
                            </div>
                        </div>
                    </div>

                    {/* Modify Signers */}
                    <div>
                        <h3 className="text-lg font-semibold text-white mb-3">Signers</h3>
                        <div className="space-y-3">
                            {signers.map((signer, index) => (
                                <div key={index} className="flex gap-2">
                                    <input
                                        type="text"
                                        value={signer}
                                        onChange={(e) => updateSigner(index, e.target.value)}
                                        placeholder={`Signer ${index + 1} address (G...)`}
                                        className="flex-1 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
                                    />
                                    {signers.length > 1 && (
                                        <button
                                            onClick={() => removeSigner(index)}
                                            className="px-4 py-2 bg-red-600/20 text-red-400 rounded-lg hover:bg-red-600/30 transition-colors"
                                        >
                                            Remove
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                        <button
                            onClick={addSigner}
                            className="mt-3 w-full min-h-[44px] px-4 py-2 border-2 border-dashed border-gray-700 text-gray-400 rounded-lg hover:border-purple-500 hover:text-purple-400 transition-colors"
                        >
                            + Add Signer
                        </button>
                    </div>

                    {/* Modify Configuration */}
                    <div className="space-y-4">
                        <h3 className="text-lg font-semibold text-white">Configuration</h3>

                        <div>
                            <label className="block text-sm font-medium text-gray-400 mb-2">
                                Approval Threshold
                            </label>
                            <input
                                type="number"
                                value={config.threshold}
                                onChange={(e) => setConfig({ ...config, threshold: parseInt(e.target.value) || 1 })}
                                min="1"
                                max={signers.filter((s) => s.trim()).length}
                                className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-purple-500"
                            />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-2">
                                    Spending Limit (stroops)
                                </label>
                                <input
                                    type="text"
                                    value={config.spendingLimit}
                                    onChange={(e) => setConfig({ ...config, spendingLimit: e.target.value })}
                                    className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-purple-500"
                                />
                                <p className="mt-1 text-xs text-gray-500">{stroopsToXLM(config.spendingLimit)} XLM</p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-2">
                                    Daily Limit (stroops)
                                </label>
                                <input
                                    type="text"
                                    value={config.dailyLimit}
                                    onChange={(e) => setConfig({ ...config, dailyLimit: e.target.value })}
                                    className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-purple-500"
                                />
                                <p className="mt-1 text-xs text-gray-500">{stroopsToXLM(config.dailyLimit)} XLM</p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-gray-700 flex flex-col sm:flex-row gap-3">
                    <button
                        onClick={handleExportTemplate}
                        className="flex-1 min-h-[44px] px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors"
                    >
                        Export as JSON
                    </button>
                    <button
                        onClick={() => setShowSaveTemplate(true)}
                        className="flex-1 min-h-[44px] px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors"
                    >
                        Save as Template
                    </button>
                    <button
                        onClick={handleClone}
                        disabled={cloning}
                        className="flex-1 min-h-[44px] px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {cloning ? 'Cloning...' : 'Clone Vault'}
                    </button>
                </div>
            </div>
        </div>
    );
}
