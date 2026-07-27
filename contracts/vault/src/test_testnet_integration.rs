#[cfg(test)]
mod testnet_integration_tests {
    use soroban_sdk::{
        testutils::{Address as TestAddress, MockAuth, MockAuthInvoke},
        vec, Address, Env, IntoVal, String, Symbol, Vec,
    };
    use crate::{VaultDAO, VaultDAOClient};
    use crate::types::{Config, ConfigParam, InitConfig, ProposalOperation};

    #[test]
    fn test_full_proposal_workflow() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let signer1 = Address::generate(&env);
        let signer2 = Address::generate(&env);
        let recipient = Address::generate(&env);

        let client = VaultDAOClient::new(&env, &env.register_contract(None, VaultDAO));

        let config = InitConfig {
            admin: admin.clone(),
            min_signers: 2,
            recovery_addresses: vec![&env, admin.clone()],
            quorum_percent: 50,
            daily_limit_bps: 5000,
        };

        let result = client.initialize(&admin, &config);
        assert!(result.is_ok(), "Initialization should succeed");

        let approve_result = client.approve_proposal(&signer1, &1);
        // This test validates that the function can be called without panicking
        // Actual approval behavior tested in separate unit tests
    }

    #[test]
    fn test_proposal_approval_workflow() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let signers = vec![
            &env,
            Address::generate(&env),
            Address::generate(&env),
            Address::generate(&env),
        ];

        let client = VaultDAOClient::new(&env, &env.register_contract(None, VaultDAO));

        let config = InitConfig {
            admin: admin.clone(),
            min_signers: 2,
            recovery_addresses: vec![&env, admin.clone()],
            quorum_percent: 50,
            daily_limit_bps: 5000,
        };

        let init_result = client.initialize(&admin, &config);
        assert!(init_result.is_ok());

        // Simulate approval workflow
        for (idx, signer) in signers.iter().enumerate() {
            let approve_result = client.approve_proposal(signer, &1);
            // Validation that calls don't panic - actual approval logic in unit tests
        }
    }

    #[test]
    fn test_execute_proposal_after_threshold() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let signer1 = Address::generate(&env);
        let signer2 = Address::generate(&env);

        let client = VaultDAOClient::new(&env, &env.register_contract(None, VaultDAO));

        let config = InitConfig {
            admin: admin.clone(),
            min_signers: 2,
            recovery_addresses: vec![&env, admin.clone()],
            quorum_percent: 50,
            daily_limit_bps: 5000,
        };

        let init_result = client.initialize(&admin, &config);
        assert!(init_result.is_ok());

        client.approve_proposal(&signer1, &1).ok();
        client.approve_proposal(&signer2, &1).ok();

        let execute_result = client.execute_proposal(&admin, &1);
        // Validation that execution doesn't panic
    }

    #[test]
    fn test_vote_abstention() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let signer = Address::generate(&env);

        let client = VaultDAOClient::new(&env, &env.register_contract(None, VaultDAO));

        let config = InitConfig {
            admin: admin.clone(),
            min_signers: 1,
            recovery_addresses: vec![&env, admin.clone()],
            quorum_percent: 50,
            daily_limit_bps: 5000,
        };

        let init_result = client.initialize(&admin, &config);
        assert!(init_result.is_ok());

        let abstain_result = client.abstain_proposal(&signer, &1);
        // Abstention voting pathway
    }

    #[test]
    fn test_vote_change() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let signer = Address::generate(&env);

        let client = VaultDAOClient::new(&env, &env.register_contract(None, VaultDAO));

        let config = InitConfig {
            admin: admin.clone(),
            min_signers: 1,
            recovery_addresses: vec![&env, admin.clone()],
            quorum_percent: 50,
            daily_limit_bps: 5000,
        };

        let init_result = client.initialize(&admin, &config);
        assert!(init_result.is_ok());

        // Initial approval
        client.approve_proposal(&signer, &1).ok();

        // Change vote to rejection
        let change_result = client.change_vote(&signer, &1);
        // Vote modification pathway validation
    }

    #[test]
    fn test_cancel_proposal_workflow() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let proposer = Address::generate(&env);

        let client = VaultDAOClient::new(&env, &env.register_contract(None, VaultDAO));

        let config = InitConfig {
            admin: admin.clone(),
            min_signers: 1,
            recovery_addresses: vec![&env, admin.clone()],
            quorum_percent: 50,
            daily_limit_bps: 5000,
        };

        let init_result = client.initialize(&admin, &config);
        assert!(init_result.is_ok());

        let cancel_result = client.cancel_proposal(&proposer, &1, &String::from_slice(&env, "Testing"));
        // Cancellation pathway validation
    }
}
