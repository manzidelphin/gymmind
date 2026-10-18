# GymMind

**Multi-tenant gym management software built for Rwanda and East Africa.**

GymMind is a full-stack SaaS project designed to help gyms manage their day-to-day operations through a central web application. The repository contains a separate React frontend and a Node.js backend.

> **Status:** Actively developed. Features and deployment requirements should be verified against the current application before production use.

## Project overview

GymMind focuses on organizing gym operations and providing a foundation for serving multiple gyms from one platform. Its codebase includes a web dashboard, an API, a relational database integration, and supporting services for communication and document generation.

### Key areas

- **Multi-tenant architecture:** Structure for managing separate gym organizations.
- **Gym operations:** Administrative workflows for running gym services.
- **Membership and records:** Data-driven gym management workflows.
- **Communication:** Integrations for email and SMS.
- **Documents and reporting:** PDF, QR code, spreadsheet, and charting libraries.
- **Web dashboard:** React-based interface with client-side routing.

These describe the project's focus and supporting technology; individual workflows may still be in development.

## Technology stack

| Layer | Technologies |
| --- | --- |
| Frontend | React 19, TypeScript, Vite |
| Routing | React Router |
| Data visualization | Recharts |
| HTTP requests | Axios |
| Backend | Node.js, Express, TypeScript |
| Database | MySQL (mysql2) |
| Authentication utilities | JSON Web Tokens |
| Validation | Zod |
| Notifications | Africa's Talking, Nodemailer |
| Documents | PDFKit, jsPDF, SheetJS (xlsx), QR code libraries |

## Repository structure

```text
gymmind/
├── backend/
│   ├── src/                 # Server source code
│   ├── sql/                 # SQL resources
│   ├── package.json         # Backend dependencies and scripts
│   └── tsconfig.json
├── frontend/
│   ├── src/                 # React application source
│   ├── package.json         # Frontend dependencies and scripts
│   └── vite.config.*        # Vite configuration (if present)
└── .gitignore
```

## Run locally

**Requirements:** Node.js, npm, and a MySQL database compatible with the backend configuration.

Clone the repository:

```bash
git clone https://github.com/manzidelphin/gymmind.git
cd gymmind
```

### Start the backend

```bash
cd backend
npm install
npm run dev
```

The backend provides these commands:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run the development server |
| `npm run build` | Compile TypeScript |
| `npm start` | Start the compiled server |
| `npm run migrate` | Run the project's migration script |

Configure your own database connection, authentication secrets, and integration credentials before running the server. Review the backend source and SQL files for the current required variables and migration sequence. **Do not run migrations against a production database without a backup and review.**

### Start the frontend

Open a second terminal in the repository root:

```bash
cd frontend
npm install
npm run dev
```

Vite will display the local URL for the development site. Ensure the frontend's API configuration points to your running backend.

Other frontend commands:

```bash
npm run build
npm run lint
npm run preview
```

## Security and configuration

- Keep `.env`, `.env.local`, database passwords, JWT secrets, and API credentials out of Git.
- Use distinct credentials and databases for development and production.
- Validate tenant ownership and user authorization on **every** protected backend operation.
- Treat SMS and email integrations as optional until their credentials and delivery settings are configured.
- Review authentication, payment-related workflows, and tenant data isolation before onboarding customers.
- Never use actual customer data in public examples, test fixtures, or screenshots without authorization.

The repository includes local Claude tooling settings. Such settings should be reviewed before committing, and machine-specific settings should generally be excluded from version control.

## Future improvements

- Document required environment variables with a sanitized `.env.example`.
- Add automated backend and frontend tests.
- Document database migrations and tenant isolation rules.
- Add screenshots or a short product demo.
- Configure continuous integration for linting, builds, and tests.

## Developer

**Manzi Delphin** · Software Engineering · Rwanda 🇷🇼

GymMind is being developed to support the digital transformation of gym management in Rwanda and the wider East African market.
