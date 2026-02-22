import React, { useEffect, useState } from 'react';
import { Loader2, LayoutTemplate } from 'lucide-react';
import { useVaultContract } from '../../hooks/useVaultContract';
import DashboardBuilder from '../../components/DashboardBuilder';
import type { DashboardLayout, WidgetConfig } from '../../types/dashboard';
import { loadSavedLayout, getDashboardTemplate, dashboardTemplates } from '../../utils/dashboardTemplates';
import { Wallet, FileText, CheckCircle, LayoutDashboard } from 'lucide-react';

interface DashboardStats {
    totalBalance: string;
    totalProposals: number;
    pendingApprovals: number;
    readyToExecute: number;
    activeSigners: number;
    threshold: string;
}

const Overview: React.FC = () => {
    const { getDashboardStats, loading } = useVaultContract();
    const [stats, setStats] = useState<DashboardStats | null>(null);
    const [currentLayout, setCurrentLayout] = useState<DashboardLayout | null>(null);
    const [showTemplates, setShowTemplates] = useState(false);

    useEffect(() => {
        let isMounted = true;
        const fetchData = async () => {
            try {
                const result = await getDashboardStats();
                if (isMounted) {
                    setStats(result as DashboardStats);
                }
            } catch (error) {
                console.error('Failed to fetch dashboard data', error);
            }
        };
        fetchData();
        return () => {
            isMounted = false;
        };
    }, [getDashboardStats]);

    useEffect(() => {
        const saved = loadSavedLayout();
        if (saved) {
            setCurrentLayout(saved);
        } else {
            const defaultTemplate = getDashboardTemplate('executive');
            if (defaultTemplate) {
                setCurrentLayout(defaultTemplate.layout);
            }
        }
    }, []);

    useEffect(() => {
        if (stats && currentLayout) {
            const updatedWidgets = currentLayout.widgets.map((widget: WidgetConfig) => {
                if (widget.id === 'stat-balance') {
                    return { ...widget, config: { ...widget.config, value: `${stats.totalBalance} XLM`, icon: Wallet } };
                }
                if (widget.id === 'stat-proposals') {
                    return { ...widget, config: { ...widget.config, value: stats.totalProposals.toString(), icon: FileText } };
                }
                if (widget.id === 'stat-ready') {
                    return { ...widget, config: { ...widget.config, value: stats.readyToExecute.toString(), icon: CheckCircle } };
                }
                if (widget.id === 'stat-signers') {
                    return { ...widget, config: { ...widget.config, value: stats.activeSigners.toString(), subtitle: `Threshold: ${stats.threshold}`, icon: LayoutDashboard } };
                }
                return widget;
            });
            setCurrentLayout({ ...currentLayout, widgets: updatedWidgets });
        }
    }, [stats]);

    const loadTemplate = (templateId: string) => {
        const template = getDashboardTemplate(templateId);
        if (template) {
            setCurrentLayout(template.layout);
            setShowTemplates(false);
        }
    };

    if (loading && !stats) {
        return (
            <div className="h-96 flex items-center justify-center">
                <Loader2 className="h-10 w-10 animate-spin text-purple-500" />
            </div>
        );
    }

    return (
        <div className="space-y-4 pb-10">
            <div className="flex justify-between items-center">
                <div className="text-sm text-gray-400 flex items-center gap-2 bg-gray-800 px-4 py-2 rounded-lg border border-gray-700">
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                    <span>Network: Testnet</span>
                </div>
                <button
                    onClick={() => setShowTemplates(!showTemplates)}
                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg flex items-center gap-2"
                >
                    <LayoutTemplate className="w-4 h-4" />
                    Templates
                </button>
            </div>

            {showTemplates && (
                <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
                    <h3 className="text-sm font-semibold text-white mb-3">Dashboard Templates</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {dashboardTemplates.map((template) => (
                            <button
                                key={template.id}
                                onClick={() => loadTemplate(template.id)}
                                className="p-4 bg-gray-900 border border-gray-700 rounded-lg hover:border-purple-500 transition-colors text-left"
                            >
                                <p className="font-medium text-white">{template.name}</p>
                                <p className="text-sm text-gray-400">{template.description}</p>
                                {template.role && <span className="text-xs text-purple-400 mt-2 inline-block">{template.role}</span>}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {currentLayout && (
                <DashboardBuilder
                    initialLayout={currentLayout}
                    onSave={(layout) => setCurrentLayout(layout)}
                />
            )}
        </div>
    );
};

export default Overview;