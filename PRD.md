# Developer Control Center — Product Requirements Document

## 1. Product Overview

### 1.1 Product Name

**Developer Control Center**

Working plugin identifier:

`omarchy.developer-control-center`

### 1.2 Product Type

Developer productivity plugin for **Omarchy 4 / Omarchy Shell**.

The plugin provides a centralized, keyboard-first dashboard for understanding and controlling the developer's current local development environment.

It consolidates information that would otherwise require checking several terminal commands or applications:

- Git repositories
- Docker containers
- locally running development services
- listening ports
- SSH hosts
- development tools
- environment problems requiring attention

The Developer Control Center is not intended to replace specialized tools such as:

- `lazygit`
- `lazydocker`
- `btop`
- `k9s`
- `docker`
- `podman`
- `kubectl`
- SSH
- terminal emulators
- code editors

Instead, it acts as an orchestration and visibility layer.

Its core philosophy is:

> Show the important state, expose the common action, and hand complex work to the appropriate tool.

---

# 2. Product Vision

Developers frequently have many things running simultaneously:

- multiple Git repositories
- development servers
- Docker Compose stacks
- databases
- SSH connections
- background processes
- local APIs
- frontend servers
- test environments
- remote development machines

Understanding the current state often involves multiple commands:

```text
git status
docker ps
docker compose ps
ss -lntp
ps aux
ssh ...
tailscale status
```

The Developer Control Center should make the overall state visible from one place.

A developer should be able to answer the following questions within seconds:

1. What projects am I currently working on?
2. Which projects have uncommitted or unpushed work?
3. What development services are running?
4. Which ports are in use?
5. What Docker containers are running?
6. Is anything unhealthy or broken?
7. Which remote development machines are available?
8. How do I quickly open the appropriate project or tool?

---

# 3. Product Principles

## 3.1 Keyboard First

Every primary workflow must be usable without a mouse.

Users should be able to:

- summon the Control Center
- search
- navigate
- open items
- execute actions
- dismiss the interface

entirely from the keyboard.

---

## 3.2 Fast

The Control Center should feel instantaneous.

Opening the UI must not trigger large synchronous scans.

Information should be discovered asynchronously and cached where appropriate.

The interface should always prioritize responsiveness over perfectly real-time information.

---

## 3.3 Local First

Core functionality must not depend on:

- cloud services
- user accounts
- remote APIs
- telemetry
- external databases

The plugin should primarily inspect information available on the local machine.

---

## 3.4 Zero Configuration First

The plugin should provide useful information immediately after installation.

Where possible it should automatically discover:

- Git repositories
- Docker containers
- running services
- listening ports
- SSH hosts
- installed developer tools

Configuration should improve discovery rather than being mandatory.

---

## 3.5 Progressive Complexity

The default interface must remain simple.

Advanced information should appear only when the user drills into an item.

For example:

```text
backend-api   feature/auth   +3
```

is preferable in the overview to showing the complete Git status.

---

## 3.6 Tool Integration Rather Than Reinvention

The plugin should not implement complex functionality already handled well by established developer tools.

For example:

```text
Repository
    ↓
Developer Control Center
    ↓
Open lazygit
```

rather than implementing interactive Git staging itself.

---

## 3.7 Native Omarchy Experience

The interface should feel like part of Omarchy rather than an application embedded inside Omarchy.

It should follow the active Omarchy theme and shell conventions wherever possible.

---

# 4. Goals

## 4.1 Primary Goals

The first release must provide:

- a persistent developer status indicator in the Omarchy bar
- a central Developer Control Center panel
- automatic Git repository discovery
- repository health/status information
- Docker container visibility
- local development service discovery
- listening-port visibility
- SSH host discovery
- integrated developer tool launching
- consolidated warnings through an Attention system
- global search across discovered resources
- keyboard-first navigation
- simple user configuration

---

## 4.2 Secondary Goals

The architecture should allow future support for:

- Podman
- Tailscale
- Kubernetes
- remote system health
- databases
- development workspaces
- custom automation
- user-defined commands
- GitHub/GitLab integration
- CI status
- project profiles
- build/test state

These features are outside the required v1.0 scope.

---

# 5. Non-Goals

Version 1.0 will not attempt to be:

- a full Git client
- a Docker Desktop replacement
- a Kubernetes dashboard
- a database client
- a terminal emulator
- a process manager
- an IDE
- a source-code browser
- a CI/CD system
- a remote monitoring platform
- a package manager
- a cloud infrastructure console

The plugin may launch applications that provide these capabilities.

---

# 6. Target Users

## 6.1 Primary User

A developer using Omarchy as their primary Linux development environment.

Typical characteristics:

- works primarily from the terminal
- uses Git extensively
- runs multiple development projects
- frequently uses Docker
- manages multiple localhost services
- prefers keyboard-driven workflows
- uses tools such as lazygit or lazydocker
- may connect to remote Linux systems through SSH

---

## 6.2 Secondary User

Power users or system engineers who use Omarchy for:

- homelab administration
- DevOps
- infrastructure development
- backend development
- local Kubernetes work
- distributed development environments

---

# 7. User Problems

## 7.1 Repository Awareness

Developers often forget which repositories contain:

- modified files
- untracked files
- staged changes
- unpushed commits
- branches behind their upstream
- merge conflicts

The user must normally inspect each repository separately.

---

## 7.2 Runtime Awareness

It may be unclear which development environments are currently running.

Examples:

- Which Docker stacks are active?
- Is Redis running?
- Did the API server stop?
- Is PostgreSQL healthy?
- Is an old development server still running?

---

## 7.3 Port Awareness

Developers frequently encounter:

```text
Address already in use
```

Finding what owns a port requires additional commands.

The Control Center should expose this directly.

---

## 7.4 Context Switching

Opening a project may involve:

1. navigating to a directory
2. opening the editor
3. opening another terminal
4. launching Git tooling
5. finding Docker services
6. locating the local URL

The Control Center should reduce these transitions.

---

## 7.5 Fragmented Tooling

Developer state is currently spread across:

- terminal windows
- Git
- Docker
- operating-system process tools
- browsers
- SSH config
- editor windows

The Control Center should provide a unified overview without replacing those systems.

---

# 8. Omarchy Integration Model

The plugin should be designed as a native Omarchy Shell plugin.

The intended logical components are:

```text
Developer Control Center
        │
        ├── Bar Widget
        │
        ├── Main Panel
        │
        └── Background Service
```

The exact implementation may evolve during technical design.

---

## 8.1 Bar Widget

Purpose:

Provide persistent, lightweight developer-environment status.

Example healthy state:

```text
DEV ●
```

Example state requiring attention:

```text
DEV ⚠ 3
```

Example expanded status:

```text
DEV ● 4 ⚠ 1
```

The widget should remain deliberately compact.

---

## 8.2 Main Panel

The primary UI surface.

It presents:

- Overview
- Projects
- Containers
- Services
- Machines
- Attention
- Search

The panel should support keyboard navigation and contextual actions.

---

## 8.3 Background Service

The service maintains discovered state independently of whether the panel is currently visible.

Potential responsibilities include:

- Git repository scanning
- Docker status refresh
- port discovery
- SSH configuration parsing
- tool discovery
- attention-state calculation
- data caching

Scanning should not block the Omarchy shell UI.

---

# 9. Information Architecture

The main navigation model is:

```text
Developer Control Center

├── Overview
├── Projects
├── Containers
├── Services
├── Machines
├── Attention
└── Search
```

Settings may either appear as another section or integrate with Omarchy plugin configuration.

---

# 10. Overview

The Overview is the default screen when the user opens the Control Center.

Example:

```text
Developer Control Center

Projects
────────────────────────────
● omarchy-plugin    main      clean
● backend-api       feature-x +3
● frontend          develop   ↑2

Containers
────────────────────────────
● postgres
● redis
● backend
○ integration-tests

Services
────────────────────────────
● :3000    frontend
● :8080    backend-api
● :5432    PostgreSQL

Machines
────────────────────────────
● dev-server
● homelab
○ build-server

Attention
────────────────────────────
⚠ backend-api · 3 modified files
⚠ frontend · 2 unpushed commits
```

The Overview should show only important information.

It is not intended to show every discovered resource.

---

# 11. Projects Module

## 11.1 Repository Discovery

Users can configure one or more project roots.

Example:

```text
~/Projects
~/Developer
~/Code
~/Work
```

The system scans these directories for Git repositories.

Default discovery depth should be limited to avoid expensive filesystem traversal.

---

## 11.2 Repository Information

For each repository the system should attempt to determine:

- repository name
- local path
- current branch
- clean/dirty state
- number of modified files
- number of staged files
- number of untracked files
- whether merge conflicts exist
- upstream branch
- commits ahead
- commits behind

---

## 11.3 Repository Status Presentation

Clean repository:

```text
● backend-api
  main
  clean
```

Modified repository:

```text
⚠ backend-api
  feature/auth
  3 modified
```

Ahead of upstream:

```text
● backend-api
  main
  ↑2
```

Behind upstream:

```text
⚠ backend-api
  main
  ↓4
```

Conflict:

```text
✕ backend-api
  feature/auth
  merge conflict
```

---

# 12. Project Details

Selecting a repository opens a contextual detail view.

Example:

```text
Backend API

~/Projects/backend-api

Git
────────────────────────
Branch       feature/auth
Modified     3
Staged       1
Untracked    2
Remote       origin
Ahead        2
Behind       0

Actions
────────────────────────
Open terminal
Open editor
Open lazygit
Copy path
Open remote repository
Refresh
```

---

# 13. Project Actions

The following actions should be considered for v1.0.

### Open Terminal

Open the configured terminal in the repository directory.

### Open Editor

Open the configured editor in the repository directory.

Examples may include:

- Neovim
- VS Code
- Zed
- other user-defined editor commands

### Open Git UI

Launch the configured Git client.

Default candidate:

```text
lazygit
```

### Copy Path

Copy the repository filesystem path.

### Open Remote

If the repository has an HTTP/HTTPS-compatible remote URL, open the remote repository in the configured browser.

### Refresh

Refresh repository state immediately.

---

# 14. Docker Module

## 14.1 Container Discovery

If Docker is available, the plugin should discover local containers.

Docker support should degrade gracefully when Docker is unavailable.

---

## 14.2 Container Information

For each container:

- container name
- ID
- image
- running state
- health state when available
- uptime
- exposed ports
- Compose project when identifiable

Optional statistics:

- CPU usage
- memory usage

These statistics should be collected only when they can be obtained without introducing significant background overhead.

---

# 15. Container Presentation

Example:

```text
Containers

backend-api
────────────────────────
● api
● postgres
● redis

monitoring
────────────────────────
● grafana
● prometheus

Other
────────────────────────
○ integration-tests
```

Compose grouping should be preferred when available.

---

# 16. Container Details

Example:

```text
postgres

Status
────────────────────────
Running
Healthy

Image
postgres:17

Ports
5432 → 5432

Compose
backend-api

Actions
────────────────────────
Open logs
Open shell
Restart
Stop
Copy container ID
Open lazydocker
```

---

# 17. Container Actions

V1 should support or provide pathways for:

- view logs
- open shell
- restart container
- stop container
- start stopped container
- copy container ID
- launch lazydocker

Potentially destructive actions should be visually distinct.

The plugin should not expose delete/remove operations in the initial release.

---

# 18. Services Module

The Services module provides visibility into locally running development services.

The system should inspect listening network ports and associate them with processes where possible.

Example:

```text
Services

● :3000
  Next.js
  ~/Projects/frontend

● :5173
  Vite
  ~/Projects/admin-ui

● :8080
  backend-api
  ~/Projects/backend-api

● :5432
  PostgreSQL
  Docker
```

---

# 19. Service Detection

The plugin may attempt to identify common technologies based on:

- process name
- command line
- container metadata
- conventional port
- working directory

Recognizable services may include:

- Node.js
- Bun
- Deno
- Vite
- Next.js
- Python
- Uvicorn
- Flask
- Django
- Go
- .NET
- Java
- PostgreSQL
- MySQL
- MariaDB
- Redis
- MongoDB
- NATS
- Grafana
- Prometheus

Detection should be best effort.

The plugin must not imply certainty where identification is ambiguous.

---

# 20. Service Details

Example:

```text
localhost:8080

Process
backend-api

PID
18342

Project
~/Projects/backend-api

Command
./backend-api --port 8080

Actions
────────────────────────
Open in browser
Copy URL
Open project
Open terminal
Show process
Stop process
```

---

# 21. Port Conflict Detection

A port can be marked as requiring attention when it matches a configured project service but is owned by an unexpected process.

Example:

```text
⚠ Port 8080

Expected
backend-api

Currently used by
python
PID 12491
```

This is an optional v1 capability if reliable project-service mapping exists.

---

# 22. Machines Module

The Machines module exposes known SSH hosts.

The primary source should be:

```text
~/.ssh/config
```

The plugin should support common SSH config patterns where practical.

---

# 23. SSH Host Information

For each host:

- SSH alias
- hostname
- username when specified
- port
- basic availability status

Optional:

- latency
- resolved address

Example:

```text
Machines

● dev-server
  192.168.1.40
  18 ms

● homelab
  homelab.local
  31 ms

○ build-server
  unreachable
```

---

# 24. Machine Actions

Selecting a host should provide:

```text
Connect with SSH
Open terminal
Copy hostname
Copy address
Ping
```

The first release should not continuously open SSH sessions merely to gather remote metrics.

---

# 25. Developer Tool Detection

The plugin should identify useful installed developer tools.

Potential candidates:

```text
lazygit
lazydocker
btop
htop
k9s
nvim
vim
docker
podman
kubectl
git
gh
jq
fzf
ripgrep
fd
```

The Control Center may expose them through a Tools or Search interface.

---

# 26. Tool Launcher

Example:

```text
Developer Tools

Git
✓ lazygit

Containers
✓ lazydocker

System
✓ btop

Kubernetes
○ k9s

Editors
✓ nvim
✓ zed
```

Only installed tools should normally appear in the command launcher.

Missing tools may be displayed in configuration or diagnostics, but the plugin should not automatically install software.

---

# 27. Attention System

The Attention system consolidates developer-environment issues.

This is a major differentiating feature.

Instead of manually checking multiple tools, developers should have one list of items requiring action.

Example:

```text
Attention

⚠ backend-api
  4 modified files

⚠ frontend
  2 commits not pushed

⚠ postgres
  container unhealthy

✕ api-tests
  container exited unexpectedly

⚠ build-server
  unreachable
```

---

# 28. Attention Categories

V1 should consider the following categories.

### Git

- merge conflict
- repository dirty
- unpushed commits
- branch significantly behind upstream

### Docker

- unhealthy container
- unexpectedly exited container

### Services

- expected service missing
- configured port collision

### Machines

- optionally indicate unavailable favorite hosts

Some categories may require user configuration before they become alerts.

---

# 29. Attention Severity

Three primary states should exist.

### Healthy

```text
●
```

No intervention required.

### Warning

```text
⚠
```

Something may require user attention.

### Error

```text
✕
```

Something has failed or is in a clearly problematic state.

The UI should not rely exclusively on color.

---

# 30. Bar Widget

The bar widget provides an at-a-glance summary.

Possible states:

```text
DEV ●
```

Everything healthy.

```text
DEV ⚠ 2
```

Two warnings.

```text
DEV ✕ 1
```

At least one significant failure.

Optional richer format:

```text
DEV 5 ● 2 ⚠
```

indicating active development resources plus warnings.

The exact display should be configurable.

---

# 31. Bar Widget Interaction

Primary activation should open the Developer Control Center.

Potential interactions:

- click → open Control Center
- configured keyboard shortcut → open Control Center

Secondary mouse interactions are optional.

Core functionality must remain keyboard accessible.

---

# 32. Global Search

Search must work across resource types.

Example query:

```text
redis
```

Possible results:

```text
Container
redis
running

Service
localhost:6379

Project
backend-api
uses Redis

Action
Open redis logs
```

---

# 33. Searchable Resource Types

Search should cover:

- projects
- containers
- services
- ports
- machines
- developer tools
- actions

---

# 34. Command Palette Behaviour

When the panel opens, typing should optionally activate search immediately.

Example:

```text
> back
```

Results:

```text
Project · backend-api
Action  · Open backend-api
Action  · Open backend-api in lazygit
Action  · Open backend-api terminal
Container · backend-api
Service · backend-api :8080
```

This should make the Control Center useful without navigating through sections.

---

# 35. Keyboard Navigation

The entire plugin should support:

```text
↑ / ↓       Navigate
Enter       Select / execute
Escape      Back / close
/           Search
```

Potential section shortcuts:

```text
P     Projects
C     Containers
S     Services
M     Machines
A     Attention
```

Shortcuts should avoid interfering with text entry while search is active.

---

# 36. Contextual Actions

Actions depend on the selected resource.

## Project

```text
Open terminal
Open editor
Open Git UI
Copy path
Open remote
```

## Container

```text
Logs
Shell
Restart
Start
Stop
Open lazydocker
```

## Service

```text
Open URL
Copy URL
Open project
Inspect process
Stop process
```

## SSH Host

```text
Connect
Open terminal
Ping
Copy hostname
Copy address
```

## Developer Tool

```text
Launch
```

---

# 37. Configuration

Configuration should be minimal for initial setup.

Core settings should include:

### Project Roots

Example:

```text
~/Projects
~/Developer
```

### Terminal

Selection or command used when launching terminal actions.

### Editor

Example:

```text
nvim
```

or:

```text
zed
```

### Git UI

Example:

```text
lazygit
```

### Container UI

Example:

```text
lazydocker
```

### Git Refresh Interval

Controls how frequently repository state is refreshed.

### Docker Refresh Interval

Controls Docker status refresh.

### Service Refresh Interval

Controls port/process discovery.

### Attention Rules

Allow specific warning categories to be enabled or disabled.

---

# 38. Automatic Configuration

On first run the plugin should attempt to detect:

- available terminal emulator
- editor commands
- lazygit
- lazydocker
- Git
- Docker
- SSH configuration
- common project root directories

It should not modify system configuration.

---

# 39. Empty States

Empty states should explain why data is unavailable.

Example:

```text
No projects found

Add a project directory in Developer
Control Center settings.

Example:
~/Projects
```

Docker unavailable:

```text
Docker not detected

Container monitoring is disabled.
```

No SSH configuration:

```text
No SSH hosts found

Hosts configured in ~/.ssh/config
will appear here automatically.
```

---

# 40. Error Handling

External commands may fail.

The plugin must gracefully handle:

- command not installed
- command timeout
- Docker daemon unavailable
- inaccessible directory
- invalid SSH configuration
- malformed Git repository
- repository permissions
- disappearing processes
- network host unavailable

Errors must not crash `omarchy-shell`.

Because third-party plugins execute inside Omarchy's long-running shell process, robustness is particularly important. The plugin should treat external data and subprocess responses defensively.

---

# 41. Performance Requirements

## Panel Opening

Opening the main panel should feel immediate.

The interface should display cached state first where available.

---

## Background Work

Heavy discovery should occur asynchronously.

Filesystem scanning must not block rendering.

---

## Git

Repositories should not continuously execute expensive Git operations unnecessarily.

Refresh should be incremental where possible.

---

## Docker

Container information should be polled at a moderate interval.

High-frequency CPU/memory polling is unnecessary for the overview.

---

## Ports

Port discovery should be frequent enough to remain useful without creating measurable background load.

---

# 42. Refresh Model

Different resources require different update frequencies.

Suggested conceptual model:

| Resource | Refresh Strategy |
|---|---|
| Git status | periodic + manual |
| Docker state | periodic |
| service ports | periodic |
| SSH config | change detection / occasional |
| tool availability | startup + manual |
| repository discovery | startup + manual / occasional |

Exact timings belong to technical design rather than this PRD.

---

# 43. Privacy

The Developer Control Center should be local-only by default.

It should not transmit:

- project names
- repository paths
- Git information
- SSH hosts
- running processes
- Docker information
- local ports
- machine information

to any external service.

---

# 44. Telemetry

No telemetry should be required.

If analytics are ever introduced, they must be:

- optional
- explicitly disclosed
- disabled by default unless there is a compelling reason otherwise

For the initial release:

**No telemetry.**

---

# 45. Security

Omarchy plugins execute as user-level code inside the shell environment.

The Developer Control Center will therefore have access to information available to the user account.

The plugin must minimize unnecessary access.

It must never:

- read SSH private keys
- transmit SSH configuration externally
- expose environment secrets unnecessarily
- display credentials
- collect arbitrary file contents
- execute commands received from remote sources

Only SSH host configuration metadata required for displaying connections should be parsed.

---

# 46. Command Safety

Commands exposed through contextual actions must be controlled.

User-visible actions should not construct unsafe shell commands from untrusted text.

Destructive actions should require deliberate interaction.

Examples:

Starting or restarting a container:

acceptable as direct actions.

Deleting containers, volumes, repositories, or files:

outside v1 scope.

---

# 47. Visual Design

The plugin should inherit the active Omarchy visual language.

Design characteristics:

- compact
- high information density
- clear hierarchy
- restrained use of color
- strong keyboard focus states
- theme integration
- minimal animation
- fast transitions
- Nerd Font/icon compatibility where appropriate

The plugin should avoid looking like a standalone desktop application.

---

# 48. Status Language

Use consistent status notation.

```text
● healthy / running
○ inactive / stopped
⚠ attention
✕ failure
```

Text should accompany icons where ambiguity exists.

---

# 49. Responsive Bar Support

Omarchy bars can appear on different edges.

The Developer Control Center bar widget should therefore have a compact presentation suitable for horizontal and vertical bars.

Full textual status should not be required when space is constrained.

Compact example:

```text
󰆍 2
```

Full example:

```text
DEV ⚠ 2
```

---

# 50. Accessibility

The UI should:

- support keyboard-only use
- maintain clear focus states
- avoid color-only status information
- provide readable contrast
- respect configured UI scale where practical
- avoid excessively small text

---

# 51. V1 Feature Scope

The following features constitute the target **1.0 release**.

## Required

- Omarchy bar widget
- main Control Center panel
- background discovery service
- project-root configuration
- Git repository discovery
- Git status
- repository actions
- Docker container discovery
- container status
- basic container actions
- local service/port discovery
- service/process association
- SSH host discovery
- SSH launch action
- developer tool detection
- global search
- contextual actions
- Attention system
- keyboard navigation
- configurable external tools
- local-only operation

---

# 52. Post-V1 Features

## Project Profiles

Allow optional project metadata describing:

- development command
- test command
- Docker project
- expected ports
- URLs
- associated services

Example conceptual profile:

```yaml
name: Backend API

commands:
  dev: make dev
  test: make test

services:
  - 8080
  - 5432
```

---

## Workspaces

A workspace represents a complete development environment.

Example:

```text
Workspace: Backend

Projects
backend-api
auth-service

Containers
postgres
redis
nats

Services
8080
4222
```

Potential actions:

```text
Start workspace
Stop workspace
Open workspace
```

---

## Tailscale

Potential capabilities:

- peer discovery
- online status
- Tailscale addresses
- SSH integration

---

## Kubernetes

Potential overview:

```text
Context
dev-cluster

Namespace
backend

Pods
12 running
1 pending
1 failed
```

The Control Center would surface health and launch tools such as `k9s` for deeper interaction.

---

## Database Awareness

Potential detection of:

- PostgreSQL
- Redis
- MySQL
- MongoDB

without implementing a database client.

---

## Remote Metrics

Optional remote-machine information such as:

- uptime
- CPU load
- memory
- disk availability

This should be opt-in rather than constantly polling every SSH host.

---

## Git Hosting Integration

Possible GitHub/GitLab integration for:

- pull requests
- CI failures
- review requests
- issues
- repository status

This would require explicit remote-service authentication and should remain separate from core local functionality.

---

## Custom Actions

Users could define commands such as:

```text
Run tests
Start development server
Build project
Deploy development environment
Open documentation
```

---

# 53. Future Module Model

Long term, individual features should behave conceptually as modules:

```text
Developer Control Center

Modules

✓ Projects
✓ Git
✓ Docker
✓ Services
✓ SSH

Optional

○ Podman
○ Tailscale
○ Kubernetes
○ Databases
○ GitHub
```

This would allow the product to grow without forcing every integration on every user.

---

# 54. User Journey — First Launch

1. User installs and enables Developer Control Center.
2. Plugin appears in the Omarchy bar.
3. Plugin automatically detects available developer tools.
4. Plugin looks for likely project directories.
5. User opens Developer Control Center.
6. Overview appears immediately.
7. If no project roots are found, configuration is offered.
8. Git repositories are discovered.
9. Docker containers appear if Docker is available.
10. Listening development services appear.
11. SSH hosts appear from SSH configuration.
12. Attention section highlights important state.

The user should receive useful results without reading documentation.

---

# 55. User Journey — Opening a Project

User summons Developer Control Center.

User types:

```text
backend
```

Search results show:

```text
Project · backend-api
Container · backend-api
Service · backend-api :8080
```

User selects the project.

Actions appear:

```text
Open terminal
Open editor
Open lazygit
Open repository
Copy path
```

User selects:

```text
Open lazygit
```

The appropriate external terminal/tool launches in the project directory.

---

# 56. User Journey — Diagnosing a Port Conflict

Developer starts an application.

Application reports:

```text
Port 8080 already in use
```

User opens Developer Control Center.

Searches:

```text
8080
```

Result:

```text
Service
localhost:8080

Process
python

PID
18423

Working directory
~/Projects/old-api
```

Actions:

```text
Open project
Open terminal
Stop process
```

The problem can be diagnosed without manually running system commands.

---

# 57. User Journey — Git Attention

The bar displays:

```text
DEV ⚠ 2
```

User opens Developer Control Center.

Attention shows:

```text
backend-api
3 modified files

frontend
2 commits ahead of origin/main
```

Selecting `backend-api` provides:

```text
Open lazygit
Open editor
Open terminal
```

The Control Center identifies the problem but delegates Git management to specialized tools.

---

# 58. User Journey — Docker Failure

A development container becomes unhealthy.

The Attention section displays:

```text
✕ backend-api

Container unhealthy
```

Selecting it presents:

```text
Open logs
Open shell
Restart
Open lazydocker
```

The user can immediately investigate the failure.

---

# 59. Success Metrics

Because the initial product is local and telemetry-free, success should primarily be evaluated qualitatively.

Indicators of a successful product include:

- developers keep the bar widget enabled
- users open the Control Center multiple times per development session
- common state questions can be answered without opening another terminal
- users can locate port ownership quickly
- users discover forgotten Git changes
- users use contextual actions to jump into specialized tools
- background operation has negligible performance impact
- plugin-related shell crashes are effectively zero

---

# 60. Quality Requirements

The plugin should be considered production-ready when:

- opening and closing the panel is reliable
- unavailable external tools do not crash the plugin
- Docker being stopped does not create persistent errors
- malformed repositories do not break global discovery
- SSH parsing failures degrade gracefully
- background scans do not noticeably affect the desktop
- keyboard navigation works throughout
- search remains responsive with large numbers of resources
- bar status accurately represents cached Attention state
- plugin disable/uninstall leaves no necessary system changes behind

---

# 61. Expected Scale

The initial implementation should comfortably support approximately:

- 100+ Git repositories
- 100+ Docker containers
- 100+ listening ports
- 100+ SSH host aliases
- dozens of detected developer tools

The interface should rely on filtering, grouping, and search rather than attempting to display everything simultaneously.

---

# 62. Technical Constraints

This PRD intentionally avoids specifying implementation details, but product behavior must respect the Omarchy Shell environment.

Developer Control Center should behave as a normal third-party Omarchy plugin and should not require modifications to Omarchy itself.

The product should assume that the plugin executes within the long-lived Omarchy Shell environment and therefore must be conservative about:

- blocking work
- memory usage
- runaway processes
- polling rates
- error propagation

---

# 63. Distribution

The plugin should ultimately be distributable as a standard Omarchy plugin repository.

Installation should follow the normal Omarchy plugin workflow.

The repository should be self-contained except for clearly documented optional external developer tools.

---

# 64. Dependencies

## Required System Capabilities

The core product assumes:

- Linux
- Omarchy 4
- Omarchy Shell
- Git

Individual modules should degrade gracefully if other tools are missing.

---

## Optional Dependencies

Potential optional integrations include:

```text
docker
lazygit
lazydocker
openssh
podman
tailscale
kubectl
k9s
```

The absence of one optional dependency must not disable unrelated modules.

---

# 65. Product Naming

Preferred name:

**Developer Control Center**

Short UI name:

**Dev Center**

Possible bar label:

```text
DEV
```

Possible command/search name:

```text
Developer Control Center
```

The complete product name is clearer for distribution while `Dev Center` is more appropriate for compact Omarchy UI surfaces.

---

# 66. Product Positioning

Short description:

> A developer command center for Omarchy. See your projects, containers, services, ports, and machines from one keyboard-first panel.

Extended description:

> Developer Control Center brings your development environment into one native Omarchy panel. Monitor Git repositories, Docker containers, local services, ports, SSH hosts, and problems requiring attention, then jump directly into your terminal, editor, lazygit, lazydocker, or other development tools.

---

# 67. Key Differentiator

The main differentiator is not any individual integration.

Git status already exists.

Docker dashboards already exist.

Port inspection already exists.

SSH launchers already exist.

The unique value is combining their **important state** into one Omarchy-native context:

```text
Projects
+
Runtime
+
Machines
+
Attention
+
Actions
────────────────
Developer Control Center
```

The user should no longer need to ask:

> What development state have I left running on this machine?

The Control Center should answer that immediately.

---

# 68. Release Strategy

A sensible release sequence is:

### 0.1 — Foundation

- bar widget
- Control Center panel
- navigation
- search framework
- basic configuration

### 0.2 — Projects

- project roots
- Git discovery
- Git state
- repository actions

### 0.3 — Runtime

- Docker discovery
- container status
- listening ports
- service detection

### 0.4 — Machines

- SSH configuration discovery
- machine actions
- availability status

### 0.5 — Attention

- consolidated warning model
- bar warning state
- repository/container/service alerts

### 0.9 — Hardening

- performance
- error handling
- large repository sets
- large container sets
- keyboard UX
- theme compatibility

### 1.0 — Stable Release

Complete first-generation Developer Control Center.

---

# 69. Acceptance Criteria for V1.0

Version 1.0 is complete when a user can install the plugin and:

- see a Developer Control Center item in the Omarchy bar
- open the Control Center from the bar or keyboard
- configure project directories
- automatically discover Git repositories
- see branch and repository status
- identify repositories with pending work
- open projects in terminal
- open projects in editor
- launch lazygit when available
- see running and stopped Docker containers
- identify unhealthy containers
- launch container logs/shell/actions
- launch lazydocker when available
- see listening development services
- determine which process owns a discovered port
- open web services in the browser
- see SSH hosts
- launch SSH connections
- search across projects, containers, services, machines, and actions
- navigate the entire primary interface by keyboard
- see consolidated problems in Attention
- see Attention state reflected in the bar widget
- operate without a cloud account
- operate without telemetry
- continue functioning when optional developer tools are absent

---

# 70. Final Product Statement

Developer Control Center should make Omarchy feel more aware of the work being performed on it.

Instead of merely displaying machine-level status such as CPU, network, and battery, it adds a **developer-level status layer**:

```text
What am I working on?
What is running?
What needs attention?
Where do I go next?
```

The plugin succeeds when a developer can press one shortcut, understand their current development environment, perform the obvious next action, and return to their work within seconds.