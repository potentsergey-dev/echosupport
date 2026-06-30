# Contributing

Thank you for improving EchoSupport.

1. Fork the repository and create a focused branch.
2. Install with `pnpm install --frozen-lockfile`.
3. Add tests for changed behavior.
4. Run `pnpm lint`, `pnpm typecheck`, `pnpm test:coverage`, and `pnpm build`.
5. Open a pull request describing the problem, solution, and manual verification.

Use TypeScript, Prettier, and the existing project patterns. Do not commit generated
build output, uploads, `.env`, API keys, customer conversations, or database dumps.

Security vulnerabilities must follow [SECURITY.md](SECURITY.md), not a public issue.
