const API_BASE = 'http://localhost:5050/api';

const state = {
  diseaseCategories: [],
  doctors: [],
  patients: [],
  conditions: [],
  diagnoses: [],
  filterDoctors: [],
  filterPatients: [],
  filterConditions: [],
  token: localStorage.getItem('mrmsToken') || '',
  user: JSON.parse(localStorage.getItem('mrmsUser') || 'null'),
  role: '',
};

const $ = (id) => document.getElementById(id);

function can(action, type) {
  if (!state.user) return false;
  if (state.role === 'Administrator') return true;
  if (state.role === 'Patient') return action === 'view' && ['portal'].includes(type);
  if (action === 'view') return true;
  if (action === 'delete') return false;
  if (state.role === 'Clinician') return action === 'edit' || action === 'create';
  if (state.role === 'Receptionist') {
    return (action === 'edit' || action === 'create') && ['patient', 'condition'].includes(type);
  }
  return false;
}

function setStatus(message, isError = false) {
  const el = $('statusMessage');
  el.textContent = message;
  el.style.color = isError ? '#c2410c' : '#667085';
}

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || error.detail || 'Request failed');
  }

  if (response.status === 204) return null;
  return response.json();
}

function saveSession(token, user) {
  state.token = token;
  state.user = user;
  state.role = user.role;
  localStorage.setItem('mrmsToken', token);
  localStorage.setItem('mrmsUser', JSON.stringify(user));
}

function clearSession() {
  state.token = '';
  state.user = null;
  state.role = '';
  localStorage.removeItem('mrmsToken');
  localStorage.removeItem('mrmsUser');
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[char]));
}

function formatDate(value) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

function options(items, valueKey, labelFn, placeholder) {
  return [`<option value="">${placeholder}</option>`]
    .concat(items.map((item) => `<option value="${item[valueKey]}">${escapeHtml(labelFn(item))}</option>`))
    .join('');
}

function uniqueOptions(items, valueFn, placeholder) {
  const values = [...new Set(items.map(valueFn).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return [`<option value="">${placeholder}</option>`]
    .concat(values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`))
    .join('');
}

function setSelectOptions(id, html, keepValue = true) {
  const select = $(id);
  const previous = select.value;
  select.innerHTML = html;
  if (keepValue) select.value = previous;
}

function actionButtons(type, id) {
  return [
    `<button type="button" class="secondary" data-action="view" data-type="${type}" data-id="${id}">View</button>`,
    can('edit', type) ? `<button type="button" data-action="edit" data-type="${type}" data-id="${id}">Edit</button>` : '',
    can('delete', type) ? `<button type="button" class="danger" data-action="delete" data-type="${type}" data-id="${id}">Delete</button>` : '',
  ].join('');
}

function badge(value, variant = '') {
  return `<span class="badge ${variant}">${escapeHtml(value || '')}</span>`;
}

function statusBadge(status) {
  const key = String(status || '').toLowerCase();
  return badge(status, `status-${key}`);
}

function severityBadge(severity) {
  const key = String(severity || '').toLowerCase();
  return badge(severity, `severity-${key}`);
}

function applyRoleUi() {
  $('currentUserName').textContent = state.user?.full_name || 'User';
  $('currentUserRole').textContent = state.role || '';
  $('adminRegisterBtn').hidden = state.role !== 'Administrator';
  $('newPatientBtn').hidden = true;
  $('newConditionBtn').hidden = !can('create', 'condition');
  $('newDoctorBtn').hidden = !can('create', 'doctor');
  $('newDiagnosisBtn').hidden = !can('create', 'diagnosis');
}

function applyNavigationForRole() {
  document.querySelectorAll('.nav-link').forEach((button) => {
    const patientOnlyHidden = state.role === 'Patient' && button.dataset.view !== 'portal';
    button.hidden = patientOnlyHidden;
  });

  const portalButton = document.querySelector('.nav-link[data-view="portal"]');
  if (!portalButton && state.role === 'Patient') {
    const button = document.createElement('button');
    button.className = 'nav-link';
    button.dataset.view = 'portal';
    button.textContent = 'My History';
    document.querySelector('nav').appendChild(button);
    button.addEventListener('click', () => switchView('portal', button));
  }
}

function switchView(view, button = document.querySelector(`.nav-link[data-view="${view}"]`)) {
  document.querySelectorAll('.nav-link, .view').forEach((el) => el.classList.remove('active'));
  if (button) button.classList.add('active');
  $(view).classList.add('active');
  $('pageTitle').textContent = button?.textContent || 'Dashboard';
}

function openModal(title, html) {
  $('modalTitle').textContent = title;
  $('modalBody').innerHTML = html;
  $('modal').hidden = false;
}

function closeModal() {
  $('modal').hidden = true;
  $('modalBody').innerHTML = '';
}

function metricRows(rows, labelKey) {
  const max = Math.max(1, ...rows.map((row) => row.total));
  return rows.length
    ? rows.map((row) => `
      <div class="metric-row">
        <span>${escapeHtml(row[labelKey])}</span>
        <div class="bar"><span style="width:${(row.total / max) * 100}%"></span></div>
        <strong>${row.total}</strong>
      </div>
    `).join('')
    : '<p>No data yet.</p>';
}

async function loadDashboard() {
  const stats = await api('/dashboard');
  $('statPatients').textContent = stats.patients;
  $('statDoctors').textContent = stats.doctors;
  $('statConditions').textContent = stats.conditions;
  $('statDiagnoses').textContent = stats.diagnoses;
  $('severityList').innerHTML = metricRows(stats.severityBreakdown, 'severity');
  $('conditionStatusList').innerHTML = metricRows(stats.conditionStatus, 'status');
}

async function loadDiseaseCategories() {
  state.diseaseCategories = await api('/disease-categories');
  const diseaseOptions = options(state.diseaseCategories, 'id', (item) => item.name, 'All diseases');
  setSelectOptions('conditionFilterDisease', diseaseOptions);
  setSelectOptions('diagnosisDiseaseFilter', diseaseOptions);
}

async function loadFilterLookups() {
  const [doctors, patients, conditions] = await Promise.all([
    api('/doctors'),
    api('/patients'),
    api('/conditions'),
  ]);
  state.filterDoctors = doctors;
  state.filterPatients = patients;
  state.filterConditions = conditions;

  setSelectOptions('doctorSpecialtyFilter', uniqueOptions(doctors, (doctor) => doctor.specialty, 'All specialties'));
  setSelectOptions('doctorDepartmentFilter', uniqueOptions(doctors, (doctor) => doctor.department, 'All departments'));
  const doctorOptions = options(doctors, 'id', (doctor) => `${doctor.name} - ${doctor.specialty}`, 'All doctors');
  setSelectOptions('conditionFilterDoctor', doctorOptions);
  setSelectOptions('diagnosisDoctorFilter', doctorOptions);
  setSelectOptions('conditionFilterSpecialty', uniqueOptions(doctors, (doctor) => doctor.specialty, 'All specialties'));

  const patientOptions = options(patients, 'id', (patient) => patient.full_name, 'All patients');
  setSelectOptions('conditionFilterPatient', patientOptions);
  setSelectOptions('diagnosisPatientFilter', patientOptions);

  setSelectOptions(
    'diagnosisConditionFilter',
    options(conditions, 'id', (condition) => `${condition.patient_name} - ${condition.disease_category}`, 'All conditions')
  );
}

async function loadDoctors() {
  const params = new URLSearchParams({
    search: $('doctorSearch').value,
    specialty: $('doctorSpecialtyFilter').value,
    department: $('doctorDepartmentFilter').value,
    hasPatients: $('doctorHasPatientsFilter').value,
  });
  state.doctors = await api(`/doctors?${params}`);
  $('doctorsTable').innerHTML = state.doctors.map((doctor) => `
    <tr>
      <td>${escapeHtml(doctor.name)}</td>
      <td>${badge(doctor.specialty, 'blue')}</td>
      <td>${escapeHtml(doctor.department)}</td>
      <td>${escapeHtml(doctor.contact)}</td>
      <td>${doctor.patient_count}</td>
      <td class="actions">${actionButtons('doctor', doctor.id)}</td>
    </tr>
  `).join('');
}

async function loadPatients() {
  const params = new URLSearchParams({
    search: $('patientSearch').value,
    gender: $('patientFilterGender').value,
    hasConditions: $('patientFilterHasConditions').value,
    dobFrom: $('patientDobFrom').value,
    dobTo: $('patientDobTo').value,
  });
  state.patients = await api(`/patients?${params}`);
  $('patientsTable').innerHTML = state.patients.map((patient) => `
    <tr>
      <td>${escapeHtml(patient.full_name)}</td>
      <td>${formatDate(patient.date_of_birth)}</td>
      <td>${badge(patient.gender, 'soft')}</td>
      <td>${escapeHtml(patient.phone)}</td>
      <td>${badge(patient.condition_count, patient.condition_count > 0 ? 'green' : 'soft')}</td>
      <td class="actions">${actionButtons('patient', patient.id)}</td>
    </tr>
  `).join('');
}

async function loadConditions() {
  const params = new URLSearchParams({
    search: $('conditionSearch').value,
    diseaseCategoryId: $('conditionFilterDisease').value,
    patientId: $('conditionFilterPatient').value,
    doctorId: $('conditionFilterDoctor').value,
    status: $('conditionFilterStatus').value,
    specialty: $('conditionFilterSpecialty').value,
    createdFrom: $('conditionCreatedFrom').value,
    createdTo: $('conditionCreatedTo').value,
  });
  state.conditions = await api(`/conditions?${params}`);
  $('conditionsTable').innerHTML = state.conditions.map((condition) => `
    <tr>
      <td>${escapeHtml(condition.patient_name)}</td>
      <td>${escapeHtml(condition.disease_category)}<br><small>${escapeHtml(condition.related_specialty)}</small></td>
      <td>${escapeHtml(condition.doctor_name)}<br><small>${escapeHtml(condition.doctor_specialty)}</small></td>
      <td>${statusBadge(condition.status)}</td>
      <td>${escapeHtml(condition.notes || '')}</td>
      <td class="actions">${actionButtons('condition', condition.id)}</td>
    </tr>
  `).join('');

  state.filterConditions = state.conditions;
}

async function loadDiagnoses() {
  const params = new URLSearchParams({
    search: $('diagnosisSearch').value,
    patientConditionId: $('diagnosisConditionFilter').value,
    patientId: $('diagnosisPatientFilter').value,
    diseaseCategoryId: $('diagnosisDiseaseFilter').value,
    doctorId: $('diagnosisDoctorFilter').value,
    severity: $('diagnosisSeverityFilter').value,
    createdFrom: $('diagnosisCreatedFrom').value,
    createdTo: $('diagnosisCreatedTo').value,
  });
  state.diagnoses = await api(`/diagnoses?${params}`);
  $('diagnosesTable').innerHTML = state.diagnoses.map((diagnosis) => `
    <tr>
      <td>${escapeHtml(diagnosis.patient_name)}</td>
      <td>${escapeHtml(diagnosis.disease_category)}</td>
      <td>${escapeHtml(diagnosis.icd_code)}</td>
      <td>${escapeHtml(diagnosis.description)}</td>
      <td>${severityBadge(diagnosis.severity)}</td>
      <td class="actions">${actionButtons('diagnosis', diagnosis.id)}</td>
    </tr>
  `).join('');
}

async function refreshAll() {
  applyRoleUi();
  applyNavigationForRole();
  if (state.role === 'Patient') {
    await loadPatientPortal();
    switchView('portal');
    return;
  }
  await loadDiseaseCategories();
  await loadFilterLookups();
  await Promise.all([loadDashboard(), loadDoctors(), loadPatients()]);
  await loadConditions();
  await loadDiagnoses();
}

function resetFields(ids) {
  ids.forEach((id) => {
    $(id).value = '';
  });
}

function resetPatientFilters() {
  resetFields(['patientSearch', 'patientFilterGender', 'patientFilterHasConditions', 'patientDobFrom', 'patientDobTo']);
  loadPatients().catch((error) => setStatus(error.message, true));
}

function resetDoctorFilters() {
  resetFields(['doctorSearch', 'doctorSpecialtyFilter', 'doctorDepartmentFilter', 'doctorHasPatientsFilter']);
  loadDoctors().catch((error) => setStatus(error.message, true));
}

function resetConditionFilters() {
  resetFields([
    'conditionSearch',
    'conditionFilterDisease',
    'conditionFilterPatient',
    'conditionFilterDoctor',
    'conditionFilterStatus',
    'conditionFilterSpecialty',
    'conditionCreatedFrom',
    'conditionCreatedTo',
  ]);
  loadConditions().catch((error) => setStatus(error.message, true));
}

function resetDiagnosisFilters() {
  resetFields([
    'diagnosisSearch',
    'diagnosisConditionFilter',
    'diagnosisPatientFilter',
    'diagnosisDiseaseFilter',
    'diagnosisDoctorFilter',
    'diagnosisSeverityFilter',
    'diagnosisCreatedFrom',
    'diagnosisCreatedTo',
  ]);
  loadDiagnoses().catch((error) => setStatus(error.message, true));
}

async function loadPatientPortal() {
  const history = await api('/me/history');
  const patient = history.patient;
  $('patientPortalContent').innerHTML = `
    <div class="detail-item"><span>Name</span><strong>${escapeHtml(patient.full_name)}</strong></div>
    <div class="detail-item"><span>Date of birth</span><strong>${formatDate(patient.date_of_birth)}</strong></div>
    <div class="detail-item"><span>Gender</span><strong>${escapeHtml(patient.gender)}</strong></div>
    <div class="detail-item"><span>Phone</span><strong>${escapeHtml(patient.phone)}</strong></div>
    <h2>My Conditions and Doctors</h2>
    ${history.conditions.map((condition) => `
      <div class="related-item">
        <strong>${escapeHtml(condition.disease_category)} - ${escapeHtml(condition.status)}</strong>
        <span>Doctor: ${escapeHtml(condition.doctor_name)} (${escapeHtml(condition.doctor_specialty)})</span>
        <span>Department: ${escapeHtml(condition.doctor_department || '')}</span>
        <span>Contact: ${escapeHtml(condition.doctor_contact || '')}</span>
        <span>${escapeHtml(condition.notes || '')}</span>
      </div>
    `).join('') || '<p>No conditions yet.</p>'}
    <h2>My Diagnoses</h2>
    ${history.diagnoses.map((diagnosis) => `
      <div class="related-item">
        <strong>${escapeHtml(diagnosis.icd_code)} - ${escapeHtml(diagnosis.severity)}</strong>
        <span>${escapeHtml(diagnosis.disease_category)}</span>
        <span>${escapeHtml(diagnosis.description)}</span>
      </div>
    `).join('') || '<p>No diagnoses yet.</p>'}
  `;
}

async function doctorsForDisease(diseaseId, selectedDoctorId = '') {
  const doctorSelect = $('conditionDoctor');
  doctorSelect.disabled = true;
  doctorSelect.innerHTML = '<option value="">Loading related doctors...</option>';

  if (!diseaseId) {
    doctorSelect.innerHTML = '<option value="">Select disease first</option>';
    return;
  }

  const doctors = await api(`/doctors/by-disease/${diseaseId}`);
  doctorSelect.innerHTML = options(doctors, 'id', (doctor) => `${doctor.name} - ${doctor.specialty}`, 'Select doctor');
  doctorSelect.disabled = doctors.length === 0;
  doctorSelect.value = selectedDoctorId;
}

function patientForm(patient = {}) {
  openModal(patient.id ? 'Edit Patient' : 'Create Patient', `
    <form id="patientForm" class="modal-form">
      <input type="hidden" id="patientId" value="${patient.id || ''}">
      <label>Full name<input id="patientName" value="${escapeHtml(patient.full_name || '')}" required></label>
      <label>Date of birth<input id="patientDob" type="date" value="${formatDate(patient.date_of_birth)}" required></label>
      <label>Gender
        <select id="patientGender" required>
          <option value="">Select gender</option>
          <option ${patient.gender === 'Female' ? 'selected' : ''}>Female</option>
          <option ${patient.gender === 'Male' ? 'selected' : ''}>Male</option>
        </select>
      </label>
      <label>Phone<input id="patientPhone" value="${escapeHtml(patient.phone || '')}" required></label>
      <div class="form-actions">
        <button type="button" class="secondary" data-close-modal>Cancel</button>
        <button type="submit">Save Patient</button>
      </div>
    </form>
  `);

  $('patientForm').addEventListener('submit', savePatient);
}

function adminRegisterForm() {
  openModal('Register User', `
    <form id="adminRegisterForm" class="modal-form">
      <label class="wide">Role
        <select id="adminUserRole" required>
          <option>Patient</option>
          <option>Receptionist</option>
          <option>Clinician</option>
          <option>Administrator</option>
        </select>
      </label>
      <label>Full name<input id="adminUserName" required></label>
      <label>Email<input id="adminUserEmail" type="email" required></label>
      <label>Password<input id="adminUserPassword" type="password" minlength="6" required></label>
      <label class="patient-only">Date of birth<input id="adminUserDob" type="date"></label>
      <label class="patient-only">Gender
        <select id="adminUserGender">
          <option value="">Select gender</option>
          <option>Female</option>
          <option>Male</option>
        </select>
      </label>
      <label class="patient-only">Phone<input id="adminUserPhone"></label>
      <div class="form-actions">
        <button type="button" class="secondary" data-close-modal>Cancel</button>
        <button type="submit">Register User</button>
      </div>
    </form>
  `);

  function syncPatientFields() {
    const isPatient = $('adminUserRole').value === 'Patient';
    document.querySelectorAll('.patient-only').forEach((el) => {
      el.hidden = !isPatient;
      el.querySelector('input, select').required = isPatient;
    });
  }

  $('adminUserRole').addEventListener('change', syncPatientFields);
  $('adminRegisterForm').addEventListener('submit', saveAdminRegisteredUser);
  syncPatientFields();
}

function doctorForm(doctor = {}) {
  openModal(doctor.id ? 'Edit Doctor' : 'Create Doctor', `
    <form id="doctorForm" class="modal-form">
      <input type="hidden" id="doctorId" value="${doctor.id || ''}">
      <label>Name<input id="doctorName" value="${escapeHtml(doctor.name || '')}" required></label>
      <label>Specialty<input id="doctorSpecialty" value="${escapeHtml(doctor.specialty || '')}" required placeholder="Cardiology"></label>
      <label>Department<input id="doctorDepartment" value="${escapeHtml(doctor.department || '')}" required></label>
      <label>Contact<input id="doctorContact" value="${escapeHtml(doctor.contact || '')}" required></label>
      <div class="form-actions">
        <button type="button" class="secondary" data-close-modal>Cancel</button>
        <button type="submit">Save Doctor</button>
      </div>
    </form>
  `);

  $('doctorForm').addEventListener('submit', saveDoctor);
}

function conditionForm(condition = {}) {
  openModal(condition.id ? 'Edit Patient Condition' : 'Create Patient Condition', `
    <form id="conditionForm" class="modal-form">
      <input type="hidden" id="conditionId" value="${condition.id || ''}">
      <label>Patient
        <select id="conditionPatient" required>
          ${options(state.patients, 'id', (patient) => patient.full_name, 'Select patient')}
        </select>
      </label>
      <label>Disease / category
        <select id="conditionDisease" required>
          ${options(state.diseaseCategories, 'id', (item) => `${item.name} - ${item.related_specialty}`, 'Select disease')}
        </select>
      </label>
      <label>Related doctor
        <select id="conditionDoctor" required disabled>
          <option value="">Select disease first</option>
        </select>
      </label>
      <label>Status
        <select id="conditionStatus" required>
          ${['Active', 'Recovered', 'Referred', 'Monitoring'].map((value) =>
            `<option ${condition.status === value ? 'selected' : ''}>${value}</option>`
          ).join('')}
        </select>
      </label>
      <label class="wide">Notes<textarea id="conditionNotes">${escapeHtml(condition.notes || '')}</textarea></label>
      <div class="form-actions">
        <button type="button" class="secondary" data-close-modal>Cancel</button>
        <button type="submit">Save Condition</button>
      </div>
    </form>
  `);

  $('conditionPatient').value = condition.patient_id || '';
  $('conditionDisease').value = condition.disease_category_id || '';
  $('conditionDisease').addEventListener('change', (event) => doctorsForDisease(event.target.value));
  if (condition.disease_category_id) doctorsForDisease(condition.disease_category_id, condition.doctor_id);
  $('conditionForm').addEventListener('submit', saveCondition);
}

function diagnosisForm(diagnosis = {}) {
  openModal(diagnosis.id ? 'Edit Diagnosis' : 'Create Diagnosis', `
    <form id="diagnosisForm" class="modal-form">
      <input type="hidden" id="diagnosisId" value="${diagnosis.id || ''}">
      <label class="wide">Patient condition
        <select id="diagnosisCondition" required>
          ${options(state.conditions, 'id', (condition) => `${condition.patient_name} - ${condition.disease_category}`, 'Select condition')}
        </select>
      </label>
      <label>ICD code<input id="diagnosisIcd" value="${escapeHtml(diagnosis.icd_code || '')}" required placeholder="I25.9"></label>
      <label>Severity
        <select id="diagnosisSeverity" required>
          ${['Mild', 'Moderate', 'Severe', 'Critical'].map((value) =>
            `<option ${diagnosis.severity === value ? 'selected' : ''}>${value}</option>`
          ).join('')}
        </select>
      </label>
      <label class="wide">Description<textarea id="diagnosisDescription" required>${escapeHtml(diagnosis.description || '')}</textarea></label>
      <div class="form-actions">
        <button type="button" class="secondary" data-close-modal>Cancel</button>
        <button type="submit">Save Diagnosis</button>
      </div>
    </form>
  `);

  $('diagnosisCondition').value = diagnosis.patient_condition_id || '';
  $('diagnosisForm').addEventListener('submit', saveDiagnosis);
}

async function savePatient(event) {
  event.preventDefault();
  const id = $('patientId').value;
  const body = {
    full_name: $('patientName').value.trim(),
    date_of_birth: $('patientDob').value,
    gender: $('patientGender').value,
    phone: $('patientPhone').value.trim(),
  };
  await api(id ? `/patients/${id}` : '/patients', {
    method: id ? 'PUT' : 'POST',
    body: JSON.stringify(body),
  });
  closeModal();
  await refreshAll();
  setStatus('Patient saved');
}

async function saveAdminRegisteredUser(event) {
  event.preventDefault();
  const role = $('adminUserRole').value;
  const body = {
    role,
    full_name: $('adminUserName').value.trim(),
    email: $('adminUserEmail').value.trim(),
    password: $('adminUserPassword').value,
  };
  if (role === 'Patient') {
    body.date_of_birth = $('adminUserDob').value;
    body.gender = $('adminUserGender').value;
    body.phone = $('adminUserPhone').value.trim();
  }
  await api('/auth/admin-register', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  closeModal();
  await refreshAll();
  setStatus(`${role} registered`);
}

async function logout() {
  await api('/auth/logout', { method: 'POST' }).catch(() => null);
  clearSession();
  window.location.href = 'index.html';
}

async function saveDoctor(event) {
  event.preventDefault();
  const id = $('doctorId').value;
  const body = {
    name: $('doctorName').value.trim(),
    specialty: $('doctorSpecialty').value.trim(),
    department: $('doctorDepartment').value.trim(),
    contact: $('doctorContact').value.trim(),
  };
  await api(id ? `/doctors/${id}` : '/doctors', {
    method: id ? 'PUT' : 'POST',
    body: JSON.stringify(body),
  });
  closeModal();
  await refreshAll();
  setStatus('Doctor saved');
}

async function saveCondition(event) {
  event.preventDefault();
  const id = $('conditionId').value;
  const body = {
    patient_id: $('conditionPatient').value,
    disease_category_id: $('conditionDisease').value,
    doctor_id: $('conditionDoctor').value,
    status: $('conditionStatus').value,
    notes: $('conditionNotes').value.trim(),
  };
  await api(id ? `/conditions/${id}` : '/conditions', {
    method: id ? 'PUT' : 'POST',
    body: JSON.stringify(body),
  });
  closeModal();
  await refreshAll();
  setStatus('Condition saved with disease-matched doctor');
}

async function saveDiagnosis(event) {
  event.preventDefault();
  const id = $('diagnosisId').value;
  const body = {
    patient_condition_id: $('diagnosisCondition').value,
    icd_code: $('diagnosisIcd').value.trim(),
    description: $('diagnosisDescription').value.trim(),
    severity: $('diagnosisSeverity').value,
  };
  await api(id ? `/diagnoses/${id}` : '/diagnoses', {
    method: id ? 'PUT' : 'POST',
    body: JSON.stringify(body),
  });
  closeModal();
  await refreshAll();
  setStatus('Diagnosis saved');
}

async function viewRecord(type, id) {
  if (type === 'patient') {
    const patient = await api(`/patients/${id}`);
    openModal('Patient View', `
      <div class="detail-list">
        <div class="detail-item"><span>Patient UUID</span><strong>${patient.id}</strong></div>
        <div class="detail-item"><span>Name</span><strong>${escapeHtml(patient.full_name)}</strong></div>
        <div class="detail-item"><span>Date of birth</span><strong>${formatDate(patient.date_of_birth)}</strong></div>
        <div class="detail-item"><span>Gender</span><strong>${escapeHtml(patient.gender)}</strong></div>
        <div class="detail-item"><span>Phone</span><strong>${escapeHtml(patient.phone)}</strong></div>
      </div>
      <h2>Conditions and Doctors</h2>
      <div class="related-list">
        ${patient.conditions.map((condition) => `
          <div class="related-item">
            <strong>${escapeHtml(condition.disease_category)} - ${escapeHtml(condition.status)}</strong>
            <span>${escapeHtml(condition.doctor_name)} (${escapeHtml(condition.doctor_specialty)})</span>
            <span>${escapeHtml(condition.notes || '')}</span>
          </div>
        `).join('') || '<p>No conditions yet.</p>'}
      </div>
    `);
  }

  if (type === 'doctor') {
    const doctor = await api(`/doctors/${id}`);
    openModal('Doctor View', `
      <div class="detail-list">
        <div class="detail-item"><span>Doctor UUID</span><strong>${doctor.id}</strong></div>
        <div class="detail-item"><span>Name</span><strong>${escapeHtml(doctor.name)}</strong></div>
        <div class="detail-item"><span>Specialty</span><strong>${escapeHtml(doctor.specialty)}</strong></div>
        <div class="detail-item"><span>Department</span><strong>${escapeHtml(doctor.department)}</strong></div>
        <div class="detail-item"><span>Contact</span><strong>${escapeHtml(doctor.contact)}</strong></div>
      </div>
      <h2>Assigned Patients</h2>
      <div class="related-list">
        ${doctor.patients.map((patient) => `
          <div class="related-item">
            <strong>${escapeHtml(patient.full_name)}</strong>
            <span>${escapeHtml(patient.disease_category)} - ${escapeHtml(patient.status)}</span>
            <span>${escapeHtml(patient.notes || '')}</span>
          </div>
        `).join('') || '<p>No assigned patients yet.</p>'}
      </div>
    `);
  }

  if (type === 'condition') {
    const condition = await api(`/conditions/${id}`);
    openModal('Condition View', `
      <div class="detail-list">
        <div class="detail-item"><span>Condition UUID</span><strong>${condition.id}</strong></div>
        <div class="detail-item"><span>Patient</span><strong>${escapeHtml(condition.patient_name)}</strong></div>
        <div class="detail-item"><span>Disease</span><strong>${escapeHtml(condition.disease_category)}</strong></div>
        <div class="detail-item"><span>Related doctor</span><strong>${escapeHtml(condition.doctor_name)} (${escapeHtml(condition.doctor_specialty)})</strong></div>
        <div class="detail-item"><span>Status</span><strong>${escapeHtml(condition.status)}</strong></div>
        <div class="detail-item"><span>Notes</span><strong>${escapeHtml(condition.notes || '')}</strong></div>
      </div>
      <h2>Diagnoses</h2>
      <div class="related-list">
        ${condition.diagnoses.map((diagnosis) => `
          <div class="related-item">
            <strong>${escapeHtml(diagnosis.icd_code)} - ${escapeHtml(diagnosis.severity)}</strong>
            <span>${escapeHtml(diagnosis.description)}</span>
          </div>
        `).join('') || '<p>No diagnoses yet.</p>'}
      </div>
    `);
  }

  if (type === 'diagnosis') {
    const diagnosis = state.diagnoses.find((item) => item.id === id);
    openModal('Diagnosis View', `
      <div class="detail-list">
        <div class="detail-item"><span>Diagnosis UUID</span><strong>${diagnosis.id}</strong></div>
        <div class="detail-item"><span>Patient</span><strong>${escapeHtml(diagnosis.patient_name)}</strong></div>
        <div class="detail-item"><span>Disease</span><strong>${escapeHtml(diagnosis.disease_category)}</strong></div>
        <div class="detail-item"><span>ICD code</span><strong>${escapeHtml(diagnosis.icd_code)}</strong></div>
        <div class="detail-item"><span>Severity</span><strong>${escapeHtml(diagnosis.severity)}</strong></div>
        <div class="detail-item"><span>Description</span><strong>${escapeHtml(diagnosis.description)}</strong></div>
      </div>
    `);
  }
}

function editRecord(type, id) {
  if (type === 'patient') patientForm(state.patients.find((item) => item.id === id));
  if (type === 'doctor') doctorForm(state.doctors.find((item) => item.id === id));
  if (type === 'condition') conditionForm(state.conditions.find((item) => item.id === id));
  if (type === 'diagnosis') diagnosisForm(state.diagnoses.find((item) => item.id === id));
}

async function deleteRecord(type, id) {
  const label = { patient: 'patient', doctor: 'doctor', condition: 'condition', diagnosis: 'diagnosis' }[type];
  if (!confirm(`Delete this ${label}?`)) return;
  const endpoints = {
    patient: `/patients/${id}`,
    doctor: `/doctors/${id}`,
    condition: `/conditions/${id}`,
    diagnosis: `/diagnoses/${id}`,
  };
  await api(endpoints[type], { method: 'DELETE' });
  await refreshAll();
  setStatus(`${label[0].toUpperCase()}${label.slice(1)} deleted`);
}

function bindEvents() {
  document.querySelectorAll('.nav-link').forEach((button) => {
    button.addEventListener('click', () => {
      switchView(button.dataset.view, button);
    });
  });

  $('logoutBtn').addEventListener('click', () => logout().catch((error) => setStatus(error.message, true)));
  $('adminRegisterBtn').addEventListener('click', adminRegisterForm);
  $('newPatientBtn').addEventListener('click', () => patientForm());
  $('newDoctorBtn').addEventListener('click', () => doctorForm());
  $('newConditionBtn').addEventListener('click', () => conditionForm());
  $('newDiagnosisBtn').addEventListener('click', () => diagnosisForm());

  ['patientSearch', 'patientFilterGender', 'patientFilterHasConditions', 'patientDobFrom', 'patientDobTo']
    .forEach((id) => $(id).addEventListener('input', () => loadPatients().catch((error) => setStatus(error.message, true))));
  ['doctorSearch', 'doctorSpecialtyFilter', 'doctorDepartmentFilter', 'doctorHasPatientsFilter']
    .forEach((id) => $(id).addEventListener('input', () => loadDoctors().catch((error) => setStatus(error.message, true))));
  [
    'conditionSearch',
    'conditionFilterDisease',
    'conditionFilterPatient',
    'conditionFilterDoctor',
    'conditionFilterStatus',
    'conditionFilterSpecialty',
    'conditionCreatedFrom',
    'conditionCreatedTo',
  ].forEach((id) => $(id).addEventListener('input', () => loadConditions().catch((error) => setStatus(error.message, true))));
  [
    'diagnosisSearch',
    'diagnosisConditionFilter',
    'diagnosisPatientFilter',
    'diagnosisDiseaseFilter',
    'diagnosisDoctorFilter',
    'diagnosisSeverityFilter',
    'diagnosisCreatedFrom',
    'diagnosisCreatedTo',
  ].forEach((id) => $(id).addEventListener('input', () => loadDiagnoses().catch((error) => setStatus(error.message, true))));

  $('resetPatientFilters').addEventListener('click', resetPatientFilters);
  $('resetDoctorFilters').addEventListener('click', resetDoctorFilters);
  $('resetConditionFilters').addEventListener('click', resetConditionFilters);
  $('resetDiagnosisFilters').addEventListener('click', resetDiagnosisFilters);

  $('modalClose').addEventListener('click', closeModal);
  $('modal').addEventListener('click', (event) => {
    if (event.target.id === 'modal' || event.target.matches('[data-close-modal]')) closeModal();
  });

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;

    try {
      const id = button.dataset.id;
      const type = button.dataset.type;
      if (button.dataset.action === 'view') await viewRecord(type, id);
      if (button.dataset.action === 'edit') editRecord(type, id);
      if (button.dataset.action === 'delete') await deleteRecord(type, id);
    } catch (error) {
      setStatus(error.message, true);
    }
  });
}

bindEvents();
if (state.token && state.user) {
  state.role = state.user.role;
  refreshAll().then(() => {
    setStatus(`Logged in as ${state.role}`);
  }).catch((error) => {
    clearSession();
    window.location.href = 'index.html';
  });
} else {
  window.location.href = 'index.html';
}
