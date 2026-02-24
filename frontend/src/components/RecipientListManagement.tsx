import { useState, useEffect } from 'react';
import { useVaultContract } from '../hooks/useVaultContract';
import { useToast } from '../hooks/useToast';
import type { ListMode } from '../types';

interface RecipientListManagementProps {
    onClose?: () => void;
}

export default function RecipientListManagement({ onClose }: RecipientListManagementProps) {
    const { getListMode, setListMode, addToWhitelist, removeFromWhitelist,
        addToBlacklist, removeFromBlacklist } = useVaultContract();
    const { notify } = useToast();

    const [mode, setModeState] = useState<ListMode>('Disabled');
    const [newAddress, setNewAddress] = useState('');
    const [whitelistAddresses, setWhitelistAddresses] = useState<string[]>([]);
    const [blacklistAddresses, setBlacklistAddresses] = useState<string[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [csvImportText, setCsvImportText] = useState('');
    const [showImportModal, setShowImportModal] = useState(false);

    useEffect(() => {
        loadListMode();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const loadListMode = async () => {
        try {
            const currentMode = await getListMode();
            setModeState(currentMode as ListMode);
        } catch (error) {
            console.error('Failed to load list mode:', error);
        }
    };

    const handleModeChange = async (newMode: ListMode) => {
        setIsLoading(true);
        try {
            await setListMode(newMode);
            setModeState(newMode);
            notify('config_updated', 'List mode updated successfully', 'success');
        } catch (error: unknown) {
            notify('config_updated', `Failed to update mode: ${error instanceof Error ? error instanceof Error ? error.message : "Failed" : "Failed"}`, 'error');
        } finally {
            setIsLoading(false);
        }
    };

    const handleAddAddress = async () => {
        if (!newAddress.trim()) {
            notify('config_updated', 'Please enter a valid address', 'error');
            return;
        }

        setIsLoading(true);
        try {
            if (mode === 'Whitelist') {
                await addToWhitelist(newAddress);
                setWhitelistAddresses([...whitelistAddresses, newAddress]);
                notify('config_updated', 'Address added to whitelist', 'success');
            } else if (mode === 'Blacklist') {
                await addToBlacklist(newAddress);
                setBlacklistAddresses([...blacklistAddresses, newAddress]);
                notify('config_updated', 'Address added to blacklist', 'success');
            }
            setNewAddress('');
        } catch (error: unknown) {
            notify('config_updated', `Failed to add address: ${error instanceof Error ? error instanceof Error ? error.message : "Failed" : "Failed"}`, 'error');
        } finally {
            setIsLoading(false);
        }
    };

    const handleRemoveAddress = async (address: string, listType: 'whitelist' | 'blacklist') => {
        setIsLoading(true);
        try {
            if (listType === 'whitelist') {
                await removeFromWhitelist(address);
                setWhitelistAddresses(whitelistAddresses.filter(a => a !== address));
                notify('config_updated', 'Address removed from whitelist', 'success');
            } else {
                await removeFromBlacklist(address);
                setBlacklistAddresses(blacklistAddresses.filter(a => a !== address));
                notify('config_updated', 'Address removed from blacklist', 'success');
            }
        } catch (error: unknown) {
            notify('config_updated', `Failed to remove address: ${error instanceof Error ? error instanceof Error ? error.message : "Failed" : "Failed"}`, 'error');
        } finally {
            setIsLoading(false);
        }
    };

    const handleImportCSV = () => {
        const lines = csvImportText.split('\n').filter(line => line.trim());
        const addresses = lines.map(line => line.trim().split(',')[0]).filter(addr => addr);

        if (addresses.length === 0) {
            notify('config_updated', 'No valid addresses found in CSV', 'error');
            return;
        }

        addresses.forEach(async (addr) => {
            try {
                if (mode === 'Whitelist') {
                    await addToWhitelist(addr);
                    setWhitelistAddresses(prev => [...prev, addr]);
                } else if (mode === 'Blacklist') {
                    await addToBlacklist(addr);
                    setBlacklistAddresses(prev => [...prev, addr]);
                }
            } catch (error) {
                console.error(`Failed to add ${addr}:`, error);
            }
        });

        notify('config_updated', `Imported ${addresses.length} addresses`, 'success');
        setCsvImportText('');
        setShowImportModal(false);
    };

    const handleExportCSV = () => {
        const addresses = mode === 'Whitelist' ? whitelistAddresses : blacklistAddresses;
        const csv = addresses.map(addr => `${addr}`).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${mode.toLowerCase()}_addresses.csv`;
        a.click();
        URL.revokeObjectURL(url);
        notify('config_updated', 'List exported successfully', 'success');
    };

    const currentList = mode === 'Whitelist' ? whitelistAddresses : blacklistAddresses;
    const filteredList = currentList.filter(addr =>
        addr.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="bg-white rounded-lg shadow-lg p-6 max-w-4xl mx-auto">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Recipient List Management</h2>
                {onClose && (
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                )}
            </div>

            {/* Mode Selector */}
            <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">List Mode</label>
                <div className="flex flex-wrap gap-2">
                    {(['Disabled', 'Whitelist', 'Blacklist'] as ListMode[]).map((m) => (
                        <button
                            key={m}
                            onClick={() => handleModeChange(m)}
                            disabled={isLoading}
                            className={`px-4 py-2 rounded-lg font-medium transition-colors ${mode === m
                                ? 'bg-blue-600 text-white'
                                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                } disabled:opacity-50`}
                        >
                            {m}
                        </button>
                    ))}
                </div>
                <p className="mt-2 text-sm text-gray-600">
                    {mode === 'Disabled' && 'No restrictions on recipients'}
                    {mode === 'Whitelist' && 'Only approved addresses can receive funds'}
                    {mode === 'Blacklist' && 'Blocked addresses cannot receive funds'}
                </p>
            </div>

            {mode !== 'Disabled' && (
                <>
                    {/* Add Address Form */}
                    <div className="mb-6">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Add Address to {mode}
                        </label>
                        <div className="flex flex-col sm:flex-row gap-2">
                            <input
                                type="text"
                                value={newAddress}
                                onChange={(e) => setNewAddress(e.target.value)}
                                placeholder="Enter Stellar address (G...)"
                                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                            <button
                                onClick={handleAddAddress}
                                disabled={isLoading || !newAddress.trim()}
                                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Add
                            </button>
                        </div>
                    </div>

                    {/* Search and Actions */}
                    <div className="mb-4 flex flex-col sm:flex-row gap-2 justify-between">
                        <input
                            type="text"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder="Search addresses..."
                            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                        <div className="flex gap-2">
                            <button
                                onClick={() => setShowImportModal(true)}
                                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                            >
                                Import CSV
                            </button>
                            <button
                                onClick={handleExportCSV}
                                disabled={currentList.length === 0}
                                className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50"
                            >
                                Export CSV
                            </button>
                        </div>
                    </div>

                    {/* Address List */}
                    <div className="border border-gray-300 rounded-lg overflow-hidden">
                        <div className="bg-gray-50 px-4 py-3 border-b border-gray-300">
                            <div className="flex justify-between items-center">
                                <span className="font-medium text-gray-700">
                                    {mode} Addresses ({filteredList.length})
                                </span>
                            </div>
                        </div>
                        <div className="max-h-96 overflow-y-auto">
                            {filteredList.length === 0 ? (
                                <div className="p-8 text-center text-gray-500">
                                    No addresses in {mode.toLowerCase()}
                                </div>
                            ) : (
                                <ul className="divide-y divide-gray-200">
                                    {filteredList.map((address) => (
                                        <li key={address} className="px-4 py-3 hover:bg-gray-50 flex justify-between items-center">
                                            <span className="font-mono text-sm text-gray-900 break-all">{address}</span>
                                            <button
                                                onClick={() => handleRemoveAddress(address, mode === 'Whitelist' ? 'whitelist' : 'blacklist')}
                                                disabled={isLoading}
                                                className="ml-4 px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700 disabled:opacity-50 flex-shrink-0"
                                            >
                                                Remove
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>

                    {/* Statistics */}
                    <div className="mt-4 p-4 bg-blue-50 rounded-lg">
                        <h3 className="font-medium text-gray-900 mb-2">Statistics</h3>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                                <span className="text-gray-600">Total Addresses:</span>
                                <span className="ml-2 font-semibold">{currentList.length}</span>
                            </div>
                            <div>
                                <span className="text-gray-600">Mode:</span>
                                <span className="ml-2 font-semibold">{mode}</span>
                            </div>
                        </div>
                    </div>
                </>
            )}

            {/* Import Modal */}
            {showImportModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-lg p-6 max-w-lg w-full">
                        <h3 className="text-xl font-bold mb-4">Import Addresses from CSV</h3>
                        <p className="text-sm text-gray-600 mb-4">
                            Enter one address per line. Format: address or address,description
                        </p>
                        <textarea
                            value={csvImportText}
                            onChange={(e) => setCsvImportText(e.target.value)}
                            placeholder="GXXXXXXX...&#10;GYYYYYYY...&#10;GZZZZZZZ..."
                            className="w-full h-48 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
                        />
                        <div className="mt-4 flex gap-2 justify-end">
                            <button
                                onClick={() => setShowImportModal(false)}
                                className="px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleImportCSV}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                            >
                                Import
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
