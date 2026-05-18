# Clinical MRMS

Full stack Medical Records Management System built with HTML, CSS, JavaScript, Node.js, Express.js, and PostgreSQL.

## Structure

- `backend/` - Express API, PostgreSQL connection, UUID schema, and seed data
- `frontend/` - Static HTML/CSS/JavaScript UI served by Express

## Setup

1. Create a PostgreSQL database:

   ```sql
   CREATE DATABASE clinical_mrms;
   ```

2. Load schema and seed data:

   ```bash
   psql -d clinical_mrms -f backend/schema.sql
   psql -d clinical_mrms -f backend/seed.sql
   ```

3. Configure environment:

   ```bash
   cp backend/.env.example backend/.env
   ```

   Update `DATABASE_URL` in `backend/.env` if your PostgreSQL user, password, host, or database name differs.

4. Install and run:

   ```bash
   cd backend
   npm install
   npm start
   ```

5. Open:

   ```text
   http://localhost:5050
   ```

   Login/register page is served from `index.html`. After successful login the app redirects to:

   ```text
   http://localhost:5050/dashboard.html
   ```

## Data Model

- `users` stores login accounts with hashed passwords and roles.
- `patients` stores only patient identity and contact details.
- `patient_conditions` stores each patient disease/category, the related doctor, notes, and status.
- `diagnoses` stores ICD and severity details for a specific patient condition.
- All main IDs are UUIDs using PostgreSQL `pgcrypto`.

This means one patient can have many conditions, and every condition can have its own disease category, matched doctor, and diagnoses.

## Authentication

- Public register creates a `Patient` account and linked `patients` record.
- The first registered account becomes `Administrator` so the system can be bootstrapped.
- Administrators can register any role from inside the app.
- Passwords are stored as PBKDF2 hashes, not plain text.
- Patient users only see their own history, assigned doctors, conditions, and diagnoses.
- Login/register and the management dashboard are separate pages. `auth.js` controls the login page, while `app.js` controls `dashboard.html`.

## Disease-to-Doctor Workflow

When adding a patient condition, the user selects a disease category first. The browser calls:

```text
GET /api/doctors/by-disease/:diseaseId
```

The backend looks up `disease_categories.related_specialty`, then returns only doctors whose `doctors.specialty` matches it. The condition create/update endpoints also validate this relationship before saving.

## Roles

The frontend sends a bearer token after login.

- `Administrator` - read, create, update, and delete all records
- `Clinician` - read, create, and update records
- `Receptionist` - read records and create/update patient conditions
- `Patient` - read only their own medical history
