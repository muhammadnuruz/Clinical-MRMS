CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DROP TABLE IF EXISTS diagnoses;
DROP TABLE IF EXISTS patient_conditions;
DROP TABLE IF EXISTS patients;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS disease_categories;
DROP TABLE IF EXISTS doctors;

CREATE TABLE doctors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL,
  specialty VARCHAR(80) NOT NULL,
  department VARCHAR(100) NOT NULL,
  contact VARCHAR(80) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE disease_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL UNIQUE,
  related_specialty VARCHAR(80) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name VARCHAR(150) NOT NULL,
  email VARCHAR(160) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('Administrator', 'Clinician', 'Receptionist', 'Patient')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  full_name VARCHAR(150) NOT NULL,
  date_of_birth DATE NOT NULL,
  gender VARCHAR(10) NOT NULL CHECK (gender IN ('Female', 'Male')),
  phone VARCHAR(40) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE patient_conditions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  disease_category_id UUID NOT NULL REFERENCES disease_categories(id) ON DELETE RESTRICT,
  doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE RESTRICT,
  notes TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Recovered', 'Referred', 'Monitoring')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE diagnoses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_condition_id UUID NOT NULL REFERENCES patient_conditions(id) ON DELETE CASCADE,
  icd_code VARCHAR(20) NOT NULL,
  description TEXT NOT NULL,
  severity VARCHAR(30) NOT NULL CHECK (severity IN ('Mild', 'Moderate', 'Severe', 'Critical')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_doctors_specialty ON doctors(specialty);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_patients_user_id ON patients(user_id);
CREATE INDEX idx_disease_categories_related_specialty ON disease_categories(related_specialty);
CREATE INDEX idx_patient_conditions_patient_id ON patient_conditions(patient_id);
CREATE INDEX idx_patient_conditions_disease_category_id ON patient_conditions(disease_category_id);
CREATE INDEX idx_patient_conditions_doctor_id ON patient_conditions(doctor_id);
CREATE INDEX idx_diagnoses_patient_condition_id ON diagnoses(patient_condition_id);
