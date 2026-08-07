# Product and demo boundary

The public `echosupport` repository is the self-hosted product. It must remain useful to
every installer without a specific sales scenario, brand, or demonstration account.

The private demo repository owns the public marketing site, fictional business data,
read-only Demo Console, lead capture, notification integrations, and any configuration that
exists only to make a sales demonstration predictable.

## Where a change belongs

Put a change in this repository when it is a secure, reusable product capability that a
normal EchoSupport installation can configure and benefit from. Examples include widget
behavior, agent settings, Inbox workflows, booking, CSAT, security, and installation
guidance.

Put a change in the private demo repository when it names or represents the demonstration
business, exposes a public sales journey, creates fixture data, grants demo-only access, or
connects demo leads to the team.

Do not add demo credentials, public agent keys, production contact details, provider keys,
or customer data to this repository.

## Bringing an idea into the product

Demo work is not automatically promoted to the public product. Before proposing a core
change, document the user problem, verify that the capability is useful outside the demo,
complete security and upgrade review, and implement it in a focused public pull request with
tests and documentation.

The private demo may track a tested core release or commit. Before it does, verify that its
overlay still applies cleanly and run its dedicated deployment checks. A demo-only overlay
must never become a required environment variable or runtime path in the public product.
