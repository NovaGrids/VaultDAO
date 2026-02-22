export interface VaultTemplate {
    id: string;
    name: string;
    description: string;
    category: 'DAO' | 'Payroll' | 'Investment' | 'Business' | 'Custom';
    icon: string;
    config: {
        signers: string[];
        threshold: number;
        spendingLimit: string;
        dailyLimit: string;
        weeklyLimit: string;
        timelockThreshold: string;
        timelockDelay: number;
    };
    features: string[];
    recommended: boolean;
}

export const PRE_BUILT_TEMPLATES: VaultTemplate[] = [
    {
        id: 'dao-treasury',
        name: 'DAO Treasury',
        description: 'High-security multi-signature vault for DAO treasuries with conservative spending limits',
        category: 'DAO',
        icon: '🏛️',
        config: {
            signers: [], // Will be filled by user
            threshold: 5,
            spendingLimit: '100000000000', // 10,000 XLM per proposal
            dailyLimit: '500000000000', // 50,000 XLM per day
            weeklyLimit: '2000000000000', // 200,000 XLM per week
            timelockThreshold: '50000000000', // 5,000 XLM
            timelockDelay: 86400, // 5 days in ledgers (~5 seconds per ledger)
        },
        features: [
            '5-of-9 multisig recommended',
            'High spending limits',
            'Long timelock for large transfers',
            'Suitable for community treasuries',
        ],
        recommended: true,
    },
    {
        id: 'payroll-vault',
        name: 'Payroll Vault',
        description: 'Medium-security vault optimized for regular payroll and recurring payments',
        category: 'Payroll',
        icon: '💰',
        config: {
            signers: [],
            threshold: 2,
            spendingLimit: '10000000000', // 1,000 XLM per proposal
            dailyLimit: '50000000000', // 5,000 XLM per day
            weeklyLimit: '200000000000', // 20,000 XLM per week
            timelockThreshold: '20000000000', // 2,000 XLM
            timelockDelay: 17280, // 1 day
        },
        features: [
            '2-of-3 multisig recommended',
            'Medium spending limits',
            'Short timelock for flexibility',
            'Optimized for recurring payments',
        ],
        recommended: true,
    },
    {
        id: 'investment-fund',
        name: 'Investment Fund',
        description: 'High-security vault for investment funds with extended timelocks for large transactions',
        category: 'Investment',
        icon: '📈',
        config: {
            signers: [],
            threshold: 3,
            spendingLimit: '500000000000', // 50,000 XLM per proposal
            dailyLimit: '1000000000000', // 100,000 XLM per day
            weeklyLimit: '5000000000000', // 500,000 XLM per week
            timelockThreshold: '100000000000', // 10,000 XLM
            timelockDelay: 172800, // 10 days
        },
        features: [
            '3-of-5 multisig recommended',
            'Very high spending limits',
            'Extended timelock for security',
            'Ideal for investment management',
        ],
        recommended: true,
    },
    {
        id: 'small-business',
        name: 'Small Business',
        description: 'Simple 2-of-2 vault for small businesses with moderate limits',
        category: 'Business',
        icon: '🏪',
        config: {
            signers: [],
            threshold: 2,
            spendingLimit: '5000000000', // 500 XLM per proposal
            dailyLimit: '20000000000', // 2,000 XLM per day
            weeklyLimit: '100000000000', // 10,000 XLM per week
            timelockThreshold: '10000000000', // 1,000 XLM
            timelockDelay: 8640, // 12 hours
        },
        features: [
            '2-of-2 multisig',
            'Moderate spending limits',
            'Quick timelock',
            'Perfect for small teams',
        ],
        recommended: false,
    },
];

export function getTemplateById(id: string): VaultTemplate | undefined {
    return PRE_BUILT_TEMPLATES.find((t) => t.id === id);
}

export function getTemplatesByCategory(category: string): VaultTemplate[] {
    if (category === 'All') return PRE_BUILT_TEMPLATES;
    return PRE_BUILT_TEMPLATES.filter((t) => t.category === category);
}

export function searchTemplates(query: string): VaultTemplate[] {
    const lowerQuery = query.toLowerCase();
    return PRE_BUILT_TEMPLATES.filter(
        (t) =>
            t.name.toLowerCase().includes(lowerQuery) ||
            t.description.toLowerCase().includes(lowerQuery) ||
            t.category.toLowerCase().includes(lowerQuery)
    );
}

export function saveCustomTemplate(template: VaultTemplate): void {
    const customTemplates = getCustomTemplates();
    customTemplates.push(template);
    localStorage.setItem('vaultCustomTemplates', JSON.stringify(customTemplates));
}

export function getCustomTemplates(): VaultTemplate[] {
    const stored = localStorage.getItem('vaultCustomTemplates');
    return stored ? JSON.parse(stored) : [];
}

export function getAllTemplates(): VaultTemplate[] {
    return [...PRE_BUILT_TEMPLATES, ...getCustomTemplates()];
}

export function deleteCustomTemplate(id: string): void {
    const customTemplates = getCustomTemplates();
    const filtered = customTemplates.filter((t) => t.id !== id);
    localStorage.setItem('vaultCustomTemplates', JSON.stringify(filtered));
}

export function exportTemplate(template: VaultTemplate): string {
    return JSON.stringify(template, null, 2);
}

export function importTemplate(jsonString: string): VaultTemplate {
    const template = JSON.parse(jsonString);

    // Validate template structure
    if (!template.id || !template.name || !template.config) {
        throw new Error('Invalid template format');
    }

    if (!template.config.signers || !template.config.threshold) {
        throw new Error('Template missing required configuration');
    }

    return template as VaultTemplate;
}

export function validateTemplate(template: VaultTemplate): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!template.name || template.name.trim().length === 0) {
        errors.push('Template name is required');
    }

    if (!template.description || template.description.trim().length === 0) {
        errors.push('Template description is required');
    }

    if (template.config.threshold < 1) {
        errors.push('Threshold must be at least 1');
    }

    if (template.config.signers.length > 0 && template.config.threshold > template.config.signers.length) {
        errors.push('Threshold cannot exceed number of signers');
    }

    if (parseInt(template.config.spendingLimit) <= 0) {
        errors.push('Spending limit must be positive');
    }

    if (parseInt(template.config.dailyLimit) <= 0) {
        errors.push('Daily limit must be positive');
    }

    if (parseInt(template.config.weeklyLimit) <= 0) {
        errors.push('Weekly limit must be positive');
    }

    return {
        valid: errors.length === 0,
        errors,
    };
}

export function stroopsToXLM(stroops: string): string {
    return (parseInt(stroops, 10) / 10000000).toLocaleString();
}
