# WebSocket access-control matrix

| Socket / action                  | Credential                           | Role / binding                  | Isolation boundary        |
| -------------------------------- | ------------------------------------ | ------------------------------- | ------------------------- |
| Operator connect                 | Signed, unexpired JWT                | OWNER, ADMIN, or OPERATOR       | JWT `tenantId`            |
| Operator browser connect         | JWT plus configured admin Origin     | OWNER, ADMIN, or OPERATOR       | `ADMIN_CORS_ORIGINS`      |
| Operator receive event           | Connected operator socket            | Any supported operator role     | Exact event tenant        |
| Visitor connect                  | `sessionId` plus matching `agentKey` | Session belongs to that agent   | Exact session and agent   |
| Visitor browser connect          | Session credential plus agent Origin | Origin allowed by session agent | Agent `allowedOrigins`    |
| Visitor receive event            | Connected visitor socket             | Matching session                | Exact event session       |
| Client-to-server event           | Connected socket                     | `ping` only                     | No business-event routing |
| Unknown or malformed client data | Connected socket                     | Ignored                         | Connection remains usable |

Server-originated event types are `session:new`, `session:status`, `session:message`,
`operator:typing`, `operator:message`, `operator:joined`, `operator:typing_visitor`, and
`appointment:new`. Operator broadcasts use the tenant subscription; visitor broadcasts use the
session subscription. Closing a socket removes its subscription bucket when it becomes empty.
