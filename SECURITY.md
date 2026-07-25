# Security policy

## Supported versions

Security fixes are applied to the latest `main` branch.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Contact the repository maintainer privately through the hosting platform, include a minimal reproduction and impact assessment, and redact all credentials and user data.

Examples of security-sensitive areas include authentication/session handling, tenant isolation, file path normalization, ZIP extraction, object storage access, quota enforcement and administrator authorization.

## Handling secrets

- Keep deployment credentials and environment secrets outside Git.
- Use `wrangler.example.toml` as the public template and maintain a private `wrangler.toml` per environment.
- Rotate a credential immediately if it is exposed in a commit, issue, log, screenshot or deployment output.
