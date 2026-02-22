import { useState } from 'react';
import TemplateMarketplace from './TemplateMarketplace';
import { stroopsToXLM, type VaultTemplate } from '../utils/vaultTemplates';

type VaultConfig = Omit<VaultTemplate['config'], 'signers'>;

interface DeployVaultProps {
    onDeploy: (config: VaultConfig, signers: string[]) => Promise<string>;
    onClose: () => void;
}

type WizardStep = 'choose' | 'signers' | 'config' | 'review';

export default function DeployVault({ onDeploy, onClose }: DeployVaultProps) {
    const [currentStep, setCurrentStep] = useState<WizardStep>('choose');
    const [showTemplateMarketplace, setShowTemplateMarketplace] = useState(false);
    const [selectedTemplate, setSelectedTemplate] = useState<VaultTemplate | null>(null);
    const [signers, setSigners] = useState<string[]>(['']);
    const [config, setConfig] = useState<VaultConfig>({
        threshold: 2,
        spendingLimit: '10000000000',
        dailyLimit: '50000000000',
        weeklyLimit: '200000000000',
        timelockThreshold: '20000000000',
        timelockDelay: 17280,
    });
    const [deploying, setDeploying] = useState(false);
    const [deployedAddress, setDeployedAddress] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const steps: { id: WizardStep; label: string; number: number }[] = [
        { id: 'choose', label: 'Choose Template', number: 1 },
        { id: 'signers', label: 'Configure Signers', number: 2 },
        { id: 'config', label: 'Set Limits', number: 3 },
        { id: 'review', label: 'Review & Deploy', number: 4 },
    ];

    const currentStepIndex = steps.findIndex((s) => s.id === currentStep);

    const handleTemplateSelect = (template: VaultTemplate) => {
        setSelectedTemplate(template);
        const { signers: templateSigners, ...configWithoutSigners } = template.config;
        setConfig(configWithoutSigners);
        if (templateSigners.length > 0) {
            setSigners(templateSigners);
        }
        setCurrentStep('signers');
    };

    const handleStartFromScratch = () => {
        setSelectedTemplate(null);
        setCurrentStep('signers');
    };

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

    const handleDeploy = async () => {
        setError(null);
        setDeploying(true);

        try {
            const validSigners = signers.filter((s) => s.trim().length > 0);

            if (validSigners.length === 0) {
                throw new Error('At least one signer is required');
            }

            if (config.threshold > validSigners.length) {
                throw new Error('Threshold cannot exceed number of signers');
            }

            const address = await onDeploy(config, validSigners);
            setDeployedAddress(address);
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : 'Deployment failed';
            setError(errorMessage);
        } finally {
            setDeploying(false);
        }
    };

    const canProceedToNextStep = () => {
        switch (currentStep) {
            case 'choose':
                return true;
            case 'signers':
                return signers.filter((s) => s.trim().length > 0).length > 0;
            case 'config':
                return config.threshold >= 1 && parseInt(config.spendingLimit) > 0;
            case 'review':
                return true;
            default:
                return false;
        }
    };

    if (deployedAddress) {
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
                        <h2 className="text-2xl font-bold text-white mb-2">Vault Deployed Successfully!</h2>
                        <p className="text-gray-400 mb-6">Your new vault is ready to use</p>

                        <div className="bg-gray-800 rounded-lg p-4 mb-6">
                            <p className="text-sm text-gray-400 mb-2">Vault Address:</p>
                            <p className="font-mono text-white break-all">{deployedAddress}</p>
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={onClose}
                                className="flex-1 min-h-[44px] px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors"
                            >
                                Close
                            </button>
                            <button
                                onClick={() => navigator.clipboard.writeText(deployedAddress)}
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

    return (
        <>
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
                <div className="w-full max-w-4xl max-h-[90vh] rounded-xl border border-gray-700 bg-gray-900 overflow-hidden flex flex-col">
                    {/* Header with Progress */}
                    <div className="p-6 border-b border-gray-700">
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-2xl font-bold text-white">Deploy New Vault</h2>
                            <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        {/* Progress Steps */}
                        <div className="flex items-center justify-between">
                            {steps.map((step, index) => (
                                <div key={step.id} className="flex items-center flex-1">
                                    <div className="flex flex-col items-center flex-1">
                                        <div
                                            className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold transition-colors ${index <= currentStepIndex
                                                ? 'bg-purple-600 text-white'
                                                : 'bg-gray-700 text-gray-400'
                                                }`}
                                        >
                                            {step.number}
                                        </div>
                                        <span className={`mt-2 text-xs hidden sm:block ${index <= currentStepIndex ? 'text-white' : 'text-gray-500'
                                            }`}>
                                            {step.label}
                                        </span>
                                    </div>
                                    {index < steps.length - 1 && (
                                        <div className={`h-1 flex-1 mx-2 ${index < currentStepIndex ? 'bg-purple-600' : 'bg-gray-700'
                                            }`} />
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Step Content */}
                    <div className="flex-1 overflow-y-auto p-6">
                        {error && (
                            <div className="mb-4 p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400">
                                {error}
                            </div>
                        )}

                        {/* Step 1: Choose Template */}
                        {currentStep === 'choose' && (
                            <div className="space-y-4">
                                <h3 className="text-lg font-semibold text-white mb-4">How would you like to start?</h3>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <button
                                        onClick={() => setShowTemplateMarketplace(true)}
                                        className="p-6 border-2 border-gray-700 rounded-lg hover:border-purple-500 transition-colors text-left"
                                    >
                                        <div className="text-4xl mb-3">📋</div>
                                        <h4 className="text-lg font-semibold text-white mb-2">Use a Template</h4>
                                        <p className="text-sm text-gray-400">
                                            Choose from pre-configured templates for common use cases
                                        </p>
                                    </button>
                                    <button
                                        onClick={handleStartFromScratch}
                                        className="p-6 border-2 border-gray-700 rounded-lg hover:border-purple-500 transition-colors text-left"
                                    >
                                        <div className="text-4xl mb-3">✨</div>
                                        <h4 className="text-lg font-semibold text-white mb-2">Start from Scratch</h4>
                                        <p className="text-sm text-gray-400">
                                            Configure your vault manually with custom settings
                                        </p>
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Step 2: Configure Signers */}
                        {currentStep === 'signers' && (
                            <div className="space-y-4">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-lg font-semibold text-white">Configure Signers</h3>
                                    {selectedTemplate && (
                                        <span className="text-sm text-gray-400">
                                            Template: {selectedTemplate.name}
                                        </span>
                                    )}
                                </div>

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
                                    className="w-full min-h-[44px] px-4 py-2 border-2 border-dashed border-gray-700 text-gray-400 rounded-lg hover:border-purple-500 hover:text-purple-400 transition-colors"
                                >
                                    + Add Signer
                                </button>
                            </div>
                        )}

                        {/* Step 3: Set Limits */}
                        {currentStep === 'config' && (
                            <div className="space-y-4">
                                <h3 className="text-lg font-semibold text-white mb-4">Set Threshold and Limits</h3>

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
                                    <p className="mt-1 text-xs text-gray-500">
                                        Number of signatures required (max: {signers.filter((s) => s.trim()).length})
                                    </p>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-400 mb-2">
                                        Spending Limit (per proposal, in stroops)
                                    </label>
                                    <input
                                        type="text"
                                        value={config.spendingLimit}
                                        onChange={(e) => setConfig({ ...config, spendingLimit: e.target.value })}
                                        className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-purple-500"
                                    />
                                    <p className="mt-1 text-xs text-gray-500">
                                        {stroopsToXLM(config.spendingLimit)} XLM
                                    </p>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-400 mb-2">
                                        Daily Limit (in stroops)
                                    </label>
                                    <input
                                        type="text"
                                        value={config.dailyLimit}
                                        onChange={(e) => setConfig({ ...config, dailyLimit: e.target.value })}
                                        className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-purple-500"
                                    />
                                    <p className="mt-1 text-xs text-gray-500">
                                        {stroopsToXLM(config.dailyLimit)} XLM
                                    </p>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-400 mb-2">
                                        Weekly Limit (in stroops)
                                    </label>
                                    <input
                                        type="text"
                                        value={config.weeklyLimit}
                                        onChange={(e) => setConfig({ ...config, weeklyLimit: e.target.value })}
                                        className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-purple-500"
                                    />
                                    <p className="mt-1 text-xs text-gray-500">
                                        {stroopsToXLM(config.weeklyLimit)} XLM
                                    </p>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-400 mb-2">
                                        Timelock Threshold (in stroops)
                                    </label>
                                    <input
                                        type="text"
                                        value={config.timelockThreshold}
                                        onChange={(e) => setConfig({ ...config, timelockThreshold: e.target.value })}
                                        className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-purple-500"
                                    />
                                    <p className="mt-1 text-xs text-gray-500">
                                        {stroopsToXLM(config.timelockThreshold)} XLM - amounts above this trigger timelock
                                    </p>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-400 mb-2">
                                        Timelock Delay (in ledgers)
                                    </label>
                                    <input
                                        type="number"
                                        value={config.timelockDelay}
                                        onChange={(e) => setConfig({ ...config, timelockDelay: parseInt(e.target.value) || 0 })}
                                        className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-purple-500"
                                    />
                                    <p className="mt-1 text-xs text-gray-500">
                                        ~{Math.round(config.timelockDelay / 17280)} days (5 seconds per ledger)
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* Step 4: Review */}
                        {currentStep === 'review' && (
                            <div className="space-y-4">
                                <h3 className="text-lg font-semibold text-white mb-4">Review Configuration</h3>

                                <div className="bg-gray-800 rounded-lg p-4 space-y-3">
                                    <div>
                                        <p className="text-sm text-gray-400">Signers</p>
                                        <div className="mt-2 space-y-1">
                                            {signers.filter((s) => s.trim()).map((signer, index) => (
                                                <p key={index} className="text-sm font-mono text-white">
                                                    {index + 1}. {signer}
                                                </p>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4 pt-3 border-t border-gray-700">
                                        <div>
                                            <p className="text-sm text-gray-400">Threshold</p>
                                            <p className="text-white font-semibold">{config.threshold} signatures</p>
                                        </div>
                                        <div>
                                            <p className="text-sm text-gray-400">Spending Limit</p>
                                            <p className="text-white font-semibold">{stroopsToXLM(config.spendingLimit)} XLM</p>
                                        </div>
                                        <div>
                                            <p className="text-sm text-gray-400">Daily Limit</p>
                                            <p className="text-white font-semibold">{stroopsToXLM(config.dailyLimit)} XLM</p>
                                        </div>
                                        <div>
                                            <p className="text-sm text-gray-400">Weekly Limit</p>
                                            <p className="text-white font-semibold">{stroopsToXLM(config.weeklyLimit)} XLM</p>
                                        </div>
                                        <div>
                                            <p className="text-sm text-gray-400">Timelock Threshold</p>
                                            <p className="text-white font-semibold">{stroopsToXLM(config.timelockThreshold)} XLM</p>
                                        </div>
                                        <div>
                                            <p className="text-sm text-gray-400">Timelock Delay</p>
                                            <p className="text-white font-semibold">~{Math.round(config.timelockDelay / 17280)} days</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Footer with Navigation */}
                    <div className="p-6 border-t border-gray-700 flex justify-between">
                        <button
                            onClick={() => {
                                const prevIndex = currentStepIndex - 1;
                                if (prevIndex >= 0) {
                                    setCurrentStep(steps[prevIndex].id);
                                }
                            }}
                            disabled={currentStepIndex === 0}
                            className="min-h-[44px] px-6 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Back
                        </button>

                        {currentStep === 'review' ? (
                            <button
                                onClick={handleDeploy}
                                disabled={deploying || !canProceedToNextStep()}
                                className="min-h-[44px] px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {deploying ? 'Deploying...' : 'Deploy Vault'}
                            </button>
                        ) : (
                            <button
                                onClick={() => {
                                    const nextIndex = currentStepIndex + 1;
                                    if (nextIndex < steps.length) {
                                        setCurrentStep(steps[nextIndex].id);
                                    }
                                }}
                                disabled={!canProceedToNextStep()}
                                className="min-h-[44px] px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Next
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {showTemplateMarketplace && (
                <TemplateMarketplace
                    onSelectTemplate={handleTemplateSelect}
                    onClose={() => setShowTemplateMarketplace(false)}
                />
            )}
        </>
    );
}
