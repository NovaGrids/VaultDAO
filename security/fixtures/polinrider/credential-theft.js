// FIXTURE ONLY — inert strings for scanner self-test; never executed.
// Simulates a credential-theft stub reading an SSH private key path.
var targets = ["/home/user/.ssh/id_rsa", "/home/user/.ssh/id_ed25519"];
var awsPath = "/home/user/.aws/credentials";
console.log(targets, awsPath);
