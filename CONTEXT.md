# Agent execution

- **Agent**: A local or remote executor identified independently of its current connection.
- **Connection**: One authenticated socket lifetime, identified by a connection ID and credential version. It owns its inbox, protocol session, status writes, and cleanup.
- **Agent connections**: The module that owns connection authority for one agent. It may retain an opening connection and retiring connections alongside the current connection. It serializes replacement and command admission, but never holds admission while waiting for a command result.
- **Protocol session**: The module that handles the handshake, heartbeat, wire messages, and pending command results for a connection.

Replacing a connection drains previously admitted messages before changing authority. Retirement marks the agent offline before a successor registers, so an abandoned replacement cannot leave it online. Late messages and commands cannot cross into a newer connection. Shutdown and revocation join cleanup already in progress.
