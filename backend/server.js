const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
require('dotenv').config();

const db = require('./db');

const app = express();
const PORT = process.env.PORT || 5050;
const pbkdf2 = promisify(crypto.pbkdf2);
const sessions = new Map();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

const roles = {
  Administrator: new Set(['read', 'write', 'delete']),
  Clinician: new Set(['read', 'write']),
  Receptionist: new Set(['read', 'write-patients']),
  Patient: new Set(['read-own']),
};

function hasPermission(permissions, permission) {
  if (permissions.has('read-own') && permission === 'read-own') return true;
  if (permission === 'read') return permissions.has('read');
  if (permission === 'write') return permissions.has('write');
  if (permission === 'delete') return permissions.has('delete');
  if (permission === 'write-patients') return permissions.has('write') || permissions.has('write-patients');
  return permissions.has(permission);
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await pbkdf2(password, salt, 120000, 32, 'sha256');
  return `pbkdf2$120000$${salt}$${derived.toString('hex')}`;
}

async function verifyPassword(password, storedHash) {
  const [scheme, iterations, salt, hash] = storedHash.split('$');
  if (scheme !== 'pbkdf2') return false;
  const derived = await pbkdf2(password, salt, Number(iterations), 32, 'sha256');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), derived);
}

function publicUser(user) {
  return {
    id: user.id,
    full_name: user.full_name,
    email: user.email,
    role: user.role,
    patient_id: user.patient_id || null,
  };
}

async function createUserWithOptionalPatient(client, payload, forcedRole = null) {
  const role = forcedRole || payload.role;
  if (!['Administrator', 'Clinician', 'Receptionist', 'Patient'].includes(role)) {
    const error = new Error('Invalid role');
    error.status = 400;
    throw error;
  }

  const passwordHash = await hashPassword(payload.password);
  const user = await client.query(
    'INSERT INTO users (full_name, email, password_hash, role) VALUES ($1, LOWER($2), $3, $4) RETURNING id, full_name, email, role',
    [payload.full_name, payload.email, passwordHash, role]
  );

  let patientId = null;
  if (role === 'Patient') {
    if (!payload.date_of_birth || !payload.gender || !payload.phone) {
      const error = new Error('Patient registration requires date_of_birth, gender, and phone');
      error.status = 400;
      throw error;
    }
    const patient = await client.query(
      'INSERT INTO patients (user_id, full_name, date_of_birth, gender, phone) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [user.rows[0].id, payload.full_name, payload.date_of_birth, payload.gender, payload.phone]
    );
    patientId = patient.rows[0].id;
  }

  return { ...user.rows[0], patient_id: patientId };
}

function issueToken(user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, publicUser(user));
  return token;
}

function requireAuth(req, res, next) {
  const header = req.header('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const user = sessions.get(token);
  if (!user) return res.status(401).json({ error: 'Login required' });
  req.user = user;
  req.userRole = user.role;
  next();
}

function requirePermission(permission) {
  return (req, res, next) => {
    const role = req.user?.role;
    const permissions = roles[role];

    if (!permissions) return res.status(401).json({ error: 'Unknown role' });
    if (!hasPermission(permissions, permission)) {
      return res.status(403).json({ error: `${role} cannot perform this action` });
    }

    req.userRole = role;
    next();
  };
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

async function doctorMatchesDisease(diseaseCategoryId, doctorId) {
  const result = await db.query(
    `SELECT d.id
     FROM disease_categories dc
     JOIN doctors d ON d.specialty = dc.related_specialty
     WHERE dc.id = $1 AND d.id = $2`,
    [diseaseCategoryId, doctorId]
  );
  return result.rowCount > 0;
}

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'Clinical MRMS API' });
});

app.post('/api/auth/register', asyncHandler(async (req, res) => {
  const userCount = await db.query('SELECT COUNT(*)::int AS total FROM users');
  const role = userCount.rows[0].total === 0 ? 'Administrator' : 'Patient';
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const user = await createUserWithOptionalPatient(client, req.body, role);
    await client.query('COMMIT');
    const token = issueToken(user);
    res.status(201).json({ token, user: publicUser(user) });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') return res.status(409).json({ error: 'Email already registered' });
    res.status(error.status || 500).json({ error: error.message });
  } finally {
    client.release();
  }
}));

app.post('/api/auth/admin-register', requireAuth, requirePermission('delete'), asyncHandler(async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const user = await createUserWithOptionalPatient(client, req.body);
    await client.query('COMMIT');
    res.status(201).json(publicUser(user));
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') return res.status(409).json({ error: 'Email already registered' });
    res.status(error.status || 500).json({ error: error.message });
  } finally {
    client.release();
  }
}));

app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const result = await db.query(
    `SELECT u.id, u.full_name, u.email, u.password_hash, u.role, p.id AS patient_id
     FROM users u
     LEFT JOIN patients p ON p.user_id = u.id
     WHERE u.email = LOWER($1)`,
    [req.body.email]
  );
  if (result.rowCount === 0 || !(await verifyPassword(req.body.password, result.rows[0].password_hash))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = issueToken(result.rows[0]);
  res.json({ token, user: publicUser(result.rows[0]) });
}));

app.post('/api/auth/logout', requireAuth, (req, res) => {
  const token = req.header('authorization').slice(7);
  sessions.delete(token);
  res.status(204).send();
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json(req.user);
});

app.use('/api', requireAuth);

app.get('/api/me/history', requirePermission('read-own'), asyncHandler(async (req, res) => {
  if (!req.user.patient_id) return res.status(404).json({ error: 'Patient profile not found' });

  const patient = await db.query('SELECT * FROM patients WHERE id = $1', [req.user.patient_id]);
  const conditions = await db.query(
    `SELECT pc.*, dc.name AS disease_category, dc.related_specialty,
            d.name AS doctor_name, d.specialty AS doctor_specialty, d.department AS doctor_department, d.contact AS doctor_contact
     FROM patient_conditions pc
     JOIN disease_categories dc ON dc.id = pc.disease_category_id
     JOIN doctors d ON d.id = pc.doctor_id
     WHERE pc.patient_id = $1
     ORDER BY pc.created_at DESC`,
    [req.user.patient_id]
  );
  const diagnoses = await db.query(
    `SELECT dg.*, dc.name AS disease_category
     FROM diagnoses dg
     JOIN patient_conditions pc ON pc.id = dg.patient_condition_id
     JOIN disease_categories dc ON dc.id = pc.disease_category_id
     WHERE pc.patient_id = $1
     ORDER BY dg.created_at DESC`,
    [req.user.patient_id]
  );

  res.json({ patient: patient.rows[0], conditions: conditions.rows, diagnoses: diagnoses.rows });
}));

app.get('/api/dashboard', requirePermission('read'), asyncHandler(async (_req, res) => {
  const [patients, doctors, conditions, diagnoses, severity, conditionStatus] = await Promise.all([
    db.query('SELECT COUNT(*)::int AS total FROM patients'),
    db.query('SELECT COUNT(*)::int AS total FROM doctors'),
    db.query('SELECT COUNT(*)::int AS total FROM patient_conditions'),
    db.query('SELECT COUNT(*)::int AS total FROM diagnoses'),
    db.query('SELECT severity, COUNT(*)::int AS total FROM diagnoses GROUP BY severity ORDER BY severity'),
    db.query('SELECT status, COUNT(*)::int AS total FROM patient_conditions GROUP BY status ORDER BY status'),
  ]);

  res.json({
    patients: patients.rows[0].total,
    doctors: doctors.rows[0].total,
    conditions: conditions.rows[0].total,
    diagnoses: diagnoses.rows[0].total,
    severityBreakdown: severity.rows,
    conditionStatus: conditionStatus.rows,
  });
}));

app.get('/api/disease-categories', requirePermission('read'), asyncHandler(async (_req, res) => {
  const result = await db.query('SELECT * FROM disease_categories ORDER BY name');
  res.json(result.rows);
}));

app.get('/api/doctors/by-disease/:diseaseId', requirePermission('read'), asyncHandler(async (req, res) => {
  const category = await db.query('SELECT * FROM disease_categories WHERE id = $1', [req.params.diseaseId]);
  if (category.rowCount === 0) return res.status(404).json({ error: 'Disease category not found' });

  const result = await db.query(
    'SELECT * FROM doctors WHERE specialty = $1 ORDER BY name',
    [category.rows[0].related_specialty]
  );
  res.json(result.rows);
}));

app.get('/api/doctors', requirePermission('read'), asyncHandler(async (req, res) => {
  const search = `%${req.query.search || ''}%`;
  const specialty = req.query.specialty || '';
  const department = req.query.department || '';
  const hasPatients = req.query.hasPatients || '';
  const result = await db.query(
    `SELECT d.*, COUNT(pc.id)::int AS patient_count
     FROM doctors d
     LEFT JOIN patient_conditions pc ON pc.doctor_id = d.id
     WHERE (d.name ILIKE $1 OR d.specialty ILIKE $1 OR d.department ILIKE $1 OR d.contact ILIKE $1)
       AND ($2 = '' OR d.specialty = $2)
       AND ($3 = '' OR d.department = $3)
     GROUP BY d.id
     HAVING ($4 = '' OR ($4 = 'yes' AND COUNT(pc.id) > 0) OR ($4 = 'no' AND COUNT(pc.id) = 0))
     ORDER BY d.name`,
    [search, specialty, department, hasPatients]
  );
  res.json(result.rows);
}));

app.get('/api/doctors/:id', requirePermission('read'), asyncHandler(async (req, res) => {
  const doctor = await db.query('SELECT * FROM doctors WHERE id = $1', [req.params.id]);
  if (doctor.rowCount === 0) return res.status(404).json({ error: 'Doctor not found' });

  const patients = await db.query(
    `SELECT pc.id AS condition_id, pc.status, pc.notes, p.id AS patient_id, p.full_name,
            dc.name AS disease_category
     FROM patient_conditions pc
     JOIN patients p ON p.id = pc.patient_id
     JOIN disease_categories dc ON dc.id = pc.disease_category_id
     WHERE pc.doctor_id = $1
     ORDER BY pc.created_at DESC`,
    [req.params.id]
  );
  res.json({ ...doctor.rows[0], patients: patients.rows });
}));

app.post('/api/doctors', requirePermission('write'), asyncHandler(async (req, res) => {
  const { name, specialty, department, contact } = req.body;
  const result = await db.query(
    'INSERT INTO doctors (name, specialty, department, contact) VALUES ($1, $2, $3, $4) RETURNING *',
    [name, specialty, department, contact]
  );
  res.status(201).json(result.rows[0]);
}));

app.put('/api/doctors/:id', requirePermission('write'), asyncHandler(async (req, res) => {
  const { name, specialty, department, contact } = req.body;
  const result = await db.query(
    'UPDATE doctors SET name = $1, specialty = $2, department = $3, contact = $4 WHERE id = $5 RETURNING *',
    [name, specialty, department, contact, req.params.id]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Doctor not found' });
  res.json(result.rows[0]);
}));

app.delete('/api/doctors/:id', requirePermission('delete'), asyncHandler(async (req, res) => {
  const result = await db.query('DELETE FROM doctors WHERE id = $1 RETURNING id', [req.params.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Doctor not found' });
  res.status(204).send();
}));

app.get('/api/patients', requirePermission('read'), asyncHandler(async (req, res) => {
  const search = `%${req.query.search || ''}%`;
  const gender = req.query.gender || '';
  const hasConditions = req.query.hasConditions || '';
  const dobFrom = req.query.dobFrom || '';
  const dobTo = req.query.dobTo || '';
  const result = await db.query(
    `SELECT p.*, COUNT(pc.id)::int AS condition_count
     FROM patients p
     LEFT JOIN patient_conditions pc ON pc.patient_id = p.id
     WHERE (p.full_name ILIKE $1 OR p.phone ILIKE $1)
       AND ($2 = '' OR p.gender = $2)
       AND ($3 = '' OR p.date_of_birth >= $3::date)
       AND ($4 = '' OR p.date_of_birth <= $4::date)
     GROUP BY p.id
     HAVING ($5 = '' OR ($5 = 'yes' AND COUNT(pc.id) > 0) OR ($5 = 'no' AND COUNT(pc.id) = 0))
     ORDER BY p.created_at DESC`,
    [search, gender, dobFrom, dobTo, hasConditions]
  );
  res.json(result.rows);
}));

app.get('/api/patients/:id', requirePermission('read'), asyncHandler(async (req, res) => {
  const patient = await db.query('SELECT * FROM patients WHERE id = $1', [req.params.id]);
  if (patient.rowCount === 0) return res.status(404).json({ error: 'Patient not found' });

  const conditions = await db.query(
    `SELECT pc.*, dc.name AS disease_category, dc.related_specialty,
            d.name AS doctor_name, d.specialty AS doctor_specialty, d.department AS doctor_department
     FROM patient_conditions pc
     JOIN disease_categories dc ON dc.id = pc.disease_category_id
     JOIN doctors d ON d.id = pc.doctor_id
     WHERE pc.patient_id = $1
     ORDER BY pc.created_at DESC`,
    [req.params.id]
  );

  const diagnoses = await db.query(
    `SELECT dg.*, pc.patient_id, dc.name AS disease_category
     FROM diagnoses dg
     JOIN patient_conditions pc ON pc.id = dg.patient_condition_id
     JOIN disease_categories dc ON dc.id = pc.disease_category_id
     WHERE pc.patient_id = $1
     ORDER BY dg.created_at DESC`,
    [req.params.id]
  );

  res.json({ ...patient.rows[0], conditions: conditions.rows, diagnoses: diagnoses.rows });
}));

app.post('/api/patients', requirePermission('write-patients'), asyncHandler(async (req, res) => {
  const { full_name, date_of_birth, gender, phone } = req.body;
  const result = await db.query(
    'INSERT INTO patients (full_name, date_of_birth, gender, phone) VALUES ($1, $2, $3, $4) RETURNING *',
    [full_name, date_of_birth, gender, phone]
  );
  res.status(201).json(result.rows[0]);
}));

app.put('/api/patients/:id', requirePermission('write-patients'), asyncHandler(async (req, res) => {
  const { full_name, date_of_birth, gender, phone } = req.body;
  const result = await db.query(
    'UPDATE patients SET full_name = $1, date_of_birth = $2, gender = $3, phone = $4 WHERE id = $5 RETURNING *',
    [full_name, date_of_birth, gender, phone, req.params.id]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Patient not found' });
  res.json(result.rows[0]);
}));

app.delete('/api/patients/:id', requirePermission('delete'), asyncHandler(async (req, res) => {
  const result = await db.query('DELETE FROM patients WHERE id = $1 RETURNING id', [req.params.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Patient not found' });
  res.status(204).send();
}));

app.get('/api/conditions', requirePermission('read'), asyncHandler(async (req, res) => {
  const search = `%${req.query.search || ''}%`;
  const diseaseCategoryId = req.query.diseaseCategoryId || '';
  const patientId = req.query.patientId || '';
  const doctorId = req.query.doctorId || '';
  const status = req.query.status || '';
  const specialty = req.query.specialty || '';
  const createdFrom = req.query.createdFrom || '';
  const createdTo = req.query.createdTo || '';
  const result = await db.query(
    `SELECT pc.*, p.full_name AS patient_name, dc.name AS disease_category, dc.related_specialty,
            d.name AS doctor_name, d.specialty AS doctor_specialty
     FROM patient_conditions pc
     JOIN patients p ON p.id = pc.patient_id
     JOIN disease_categories dc ON dc.id = pc.disease_category_id
     JOIN doctors d ON d.id = pc.doctor_id
     WHERE (p.full_name ILIKE $1 OR dc.name ILIKE $1 OR d.name ILIKE $1 OR pc.status ILIKE $1)
       AND ($2 = '' OR pc.disease_category_id = $2::uuid)
       AND ($3 = '' OR pc.patient_id = $3::uuid)
       AND ($4 = '' OR pc.doctor_id = $4::uuid)
       AND ($5 = '' OR pc.status = $5)
       AND ($6 = '' OR d.specialty = $6)
       AND ($7 = '' OR pc.created_at::date >= $7::date)
       AND ($8 = '' OR pc.created_at::date <= $8::date)
     ORDER BY pc.created_at DESC`,
    [search, diseaseCategoryId, patientId, doctorId, status, specialty, createdFrom, createdTo]
  );
  res.json(result.rows);
}));

app.get('/api/conditions/:id', requirePermission('read'), asyncHandler(async (req, res) => {
  const condition = await db.query(
    `SELECT pc.*, p.full_name AS patient_name, dc.name AS disease_category, dc.related_specialty,
            d.name AS doctor_name, d.specialty AS doctor_specialty, d.department AS doctor_department
     FROM patient_conditions pc
     JOIN patients p ON p.id = pc.patient_id
     JOIN disease_categories dc ON dc.id = pc.disease_category_id
     JOIN doctors d ON d.id = pc.doctor_id
     WHERE pc.id = $1`,
    [req.params.id]
  );
  if (condition.rowCount === 0) return res.status(404).json({ error: 'Condition not found' });

  const diagnoses = await db.query('SELECT * FROM diagnoses WHERE patient_condition_id = $1 ORDER BY created_at DESC', [req.params.id]);
  res.json({ ...condition.rows[0], diagnoses: diagnoses.rows });
}));

app.post('/api/conditions', requirePermission('write-patients'), asyncHandler(async (req, res) => {
  const { patient_id, disease_category_id, doctor_id, notes, status } = req.body;
  if (!(await doctorMatchesDisease(disease_category_id, doctor_id))) {
    return res.status(400).json({ error: 'Selected doctor is not related to the selected disease category' });
  }

  const result = await db.query(
    `INSERT INTO patient_conditions (patient_id, disease_category_id, doctor_id, notes, status)
     VALUES ($1, $2, $3, $4, COALESCE($5, 'Active')) RETURNING *`,
    [patient_id, disease_category_id, doctor_id, notes || null, status || null]
  );
  res.status(201).json(result.rows[0]);
}));

app.put('/api/conditions/:id', requirePermission('write-patients'), asyncHandler(async (req, res) => {
  const { patient_id, disease_category_id, doctor_id, notes, status } = req.body;
  if (!(await doctorMatchesDisease(disease_category_id, doctor_id))) {
    return res.status(400).json({ error: 'Selected doctor is not related to the selected disease category' });
  }

  const result = await db.query(
    `UPDATE patient_conditions
     SET patient_id = $1, disease_category_id = $2, doctor_id = $3, notes = $4, status = $5
     WHERE id = $6 RETURNING *`,
    [patient_id, disease_category_id, doctor_id, notes || null, status, req.params.id]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Condition not found' });
  res.json(result.rows[0]);
}));

app.delete('/api/conditions/:id', requirePermission('delete'), asyncHandler(async (req, res) => {
  const result = await db.query('DELETE FROM patient_conditions WHERE id = $1 RETURNING id', [req.params.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Condition not found' });
  res.status(204).send();
}));

app.get('/api/diagnoses', requirePermission('read'), asyncHandler(async (req, res) => {
  const search = `%${req.query.search || ''}%`;
  const patientConditionId = req.query.patientConditionId || '';
  const patientId = req.query.patientId || '';
  const diseaseCategoryId = req.query.diseaseCategoryId || '';
  const severity = req.query.severity || '';
  const doctorId = req.query.doctorId || '';
  const createdFrom = req.query.createdFrom || '';
  const createdTo = req.query.createdTo || '';
  const result = await db.query(
    `SELECT dg.*, p.full_name AS patient_name, dc.name AS disease_category, d.name AS doctor_name
     FROM diagnoses dg
     JOIN patient_conditions pc ON pc.id = dg.patient_condition_id
     JOIN patients p ON p.id = pc.patient_id
     JOIN disease_categories dc ON dc.id = pc.disease_category_id
     JOIN doctors d ON d.id = pc.doctor_id
     WHERE (p.full_name ILIKE $1 OR dc.name ILIKE $1 OR dg.icd_code ILIKE $1 OR dg.description ILIKE $1 OR dg.severity ILIKE $1)
       AND ($2 = '' OR dg.patient_condition_id = $2::uuid)
       AND ($3 = '' OR pc.patient_id = $3::uuid)
       AND ($4 = '' OR pc.disease_category_id = $4::uuid)
       AND ($5 = '' OR dg.severity = $5)
       AND ($6 = '' OR pc.doctor_id = $6::uuid)
       AND ($7 = '' OR dg.created_at::date >= $7::date)
       AND ($8 = '' OR dg.created_at::date <= $8::date)
     ORDER BY dg.created_at DESC`,
    [search, patientConditionId, patientId, diseaseCategoryId, severity, doctorId, createdFrom, createdTo]
  );
  res.json(result.rows);
}));

app.post('/api/diagnoses', requirePermission('write'), asyncHandler(async (req, res) => {
  const { patient_condition_id, icd_code, description, severity } = req.body;
  const result = await db.query(
    'INSERT INTO diagnoses (patient_condition_id, icd_code, description, severity) VALUES ($1, $2, $3, $4) RETURNING *',
    [patient_condition_id, icd_code, description, severity]
  );
  res.status(201).json(result.rows[0]);
}));

app.put('/api/diagnoses/:id', requirePermission('write'), asyncHandler(async (req, res) => {
  const { patient_condition_id, icd_code, description, severity } = req.body;
  const result = await db.query(
    'UPDATE diagnoses SET patient_condition_id = $1, icd_code = $2, description = $3, severity = $4 WHERE id = $5 RETURNING *',
    [patient_condition_id, icd_code, description, severity, req.params.id]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Diagnosis not found' });
  res.json(result.rows[0]);
}));

app.delete('/api/diagnoses/:id', requirePermission('delete'), asyncHandler(async (req, res) => {
  const result = await db.query('DELETE FROM diagnoses WHERE id = $1 RETURNING id', [req.params.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Diagnosis not found' });
  res.status(204).send();
}));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error', detail: err.message });
});

app.listen(PORT, () => {
  console.log(`Clinical MRMS API running on http://localhost:${PORT}`);
});
