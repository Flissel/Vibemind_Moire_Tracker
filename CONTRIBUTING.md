# Contributing to MoireTracker

Thank you for your interest in contributing to MoireTracker! This document provides guidelines and instructions for contributing.

## Getting Started

### Prerequisites

- Node.js 18+
- Python 3.10+
- Docker (optional, for Redis)
- Tesseract OCR (for local OCR)

### Development Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/YOUR_USERNAME/MoireTracker.git
   cd MoireTracker
   ```

2. Install Node.js dependencies:
   ```bash
   npm install
   ```

3. Install Python dependencies:
   ```bash
   cd python
   pip install -r requirements.txt
   ```

4. Copy environment template:
   ```bash
   cp .env.example .env
   # Edit .env with your API keys
   ```

5. Start development server:
   ```bash
   npm run dev
   ```

## How to Contribute

### Reporting Bugs

- Use the GitHub issue tracker
- Include steps to reproduce
- Include expected vs actual behavior
- Include environment details (OS, Node version, Python version)

### Feature Requests

- Open an issue describing the feature
- Explain the use case
- Discuss implementation approach

### Pull Requests

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Run tests: `npm test`
5. Run linting: `npm run lint`
6. Commit with clear message: `git commit -m "Add: feature description"`
7. Push to your fork: `git push origin feature/my-feature`
8. Open a Pull Request

### Commit Message Format

Use clear, descriptive commit messages:

- `Add: new feature description`
- `Fix: bug description`
- `Update: what was updated`
- `Remove: what was removed`
- `Refactor: what was refactored`
- `Docs: documentation changes`

## Code Style

### TypeScript

- Use ESLint configuration provided
- Follow existing code patterns
- Add JSDoc comments for public APIs

### Python

- Follow PEP 8 style guide
- Use type hints
- Add docstrings for functions/classes

## Project Structure

```
MoireTracker/
├── src/           # TypeScript source
├── python/        # Python agents
├── docker/        # Docker configuration
├── docs/          # Documentation
└── tests/         # Test files
```

## Testing

```bash
# TypeScript tests
npm test

# Python tests
cd python
pytest
```

## Questions?

- Open a GitHub issue
- Check existing documentation in `/docs`

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
