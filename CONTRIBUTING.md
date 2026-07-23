# Contributing to Google Workspace JIT Access Portal

First off, thank you for considering contributing to the Google Workspace JIT Access Portal! It's open-source projects like this that help organizations enforce least-privilege security natively on Google Workspace.

---

## Code of Conduct

This project adheres to standard open-source community standards. Please be respectful, constructive, and collaborative in all communications, issues, and pull requests.

---

## How Can I Contribute?

### 1. Reporting Bugs
Before creating a bug report, please check the [existing issues](https://github.com/damian-sztankowski/gws-jit/issues) to avoid duplicates.

When filing a bug report, use the **Bug Report** issue template and include:
* Clear, descriptive title.
* Steps to reproduce the behavior.
* Expected vs actual behavior.
* Environment details (Node.js version, OS, browser, deployment mode: MOCK or LIVE).

### 2. Suggesting Enhancements
Feature requests are tracked via GitHub issues. Use the **Feature Request** template to explain the use case and proposed design.

### 3. Submitting Pull Requests
* Fork the repository and create your branch from `main`.
* Ensure your changes follow our code style, accessibility standards, and pass all automated CI checks (`npm run build`).
* Include tests or manual verification steps for new features or bug fixes.

---

## Commit Message Guidelines (Conventional Commits)

We enforce the [Conventional Commits](https://www.conventionalcommits.org/) specification for clear git history and automated release notes:

Format: `<type>(<scope>): <short summary>`

Types:
* `feat`: A new feature or capability.
* `fix`: A bug fix.
* `docs`: Documentation changes only.
* `style`: Formatting, missing semi-colons, etc.; no code change.
* `refactor`: A code change that neither fixes a bug nor adds a feature.
* `perf`: A code change that improves performance.
* `test`: Adding missing tests or correcting existing tests.
* `chore`: Maintenance tasks, dependency updates, build configs.

Examples:
* `feat(abac): add support for multiple required tag matching`
* `fix(auth): sanitize search params against open redirect vectors`
* `docs(readme): add interactive mermaid architecture flow`

---

## Local Development Setup

1. **Clone and Install Dependencies**:
   ```bash
   git clone https://github.com/damian-sztankowski/gws-jit.git
   cd gws-jit
   npm install
   ```

2. **Run Development Mode**:
   ```bash
   npm run dev
   ```
   * Frontend runs on `http://localhost:3000`
   * Express API server runs on `http://localhost:3001`

3. **Verify Build**:
   ```bash
   npm run build
   ```

---

## Security Vulnerabilities

If you discover a security vulnerability, please **DO NOT** open a public GitHub issue. Refer to our [SECURITY.md](SECURITY.md) policy for encrypted or private disclosure procedures.
