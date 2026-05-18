# Clinical MRMS Backend

## Setup

1. Create a PostgreSQL database named `clinical_mrms`.
2. Copy `.env.example` to `.env` and update `DATABASE_URL` if needed.
3. Install dependencies:

```bash
npm install
```

4. Load schema and seed data:

```bash
psql -d clinical_mrms -f schema.sql
psql -d clinical_mrms -f seed.sql
```

5. Start the API:

```bash
npm start
```

The API runs on `http://localhost:5050` by default.

## Role Header

Send `x-user-role` as `Administrator`, `Clinician`, or `Receptionist`.
