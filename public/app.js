document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('login-form');
  const schoolNumberInput = document.getElementById('school-number');
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const togglePasswordBtn = document.getElementById('toggle-password');
  const submitBtn = document.getElementById('submit-btn');
  const btnText = submitBtn.querySelector('.btn-text');
  const btnLoader = submitBtn.querySelector('.btn-loader');
  const statusMessage = document.getElementById('status-message');
  const statusText = document.getElementById('status-text');

  const loginCard = document.getElementById('login-card');
  const successCard = document.getElementById('success-card');
  const connectedUserSpan = document.getElementById('connected-user');
  const disconnectBtn = document.getElementById('disconnect-btn');
  const coursesContainer = document.getElementById('courses-container');
  const teachersAccordion = document.getElementById('teachers-accordion');
  const totalCoursesBadge = document.getElementById('total-courses-badge');
  const exportAllBtn = document.getElementById('export-all-btn');
  const progressOverlay = document.getElementById('progress-overlay');
  const progressModalTitle = document.getElementById('progress-modal-title');
  const progressStatus = document.getElementById('progress-status');
  const progressBarFill = document.getElementById('progress-bar-fill');
  const progressPercentage = document.getElementById('progress-percentage');
  const progressFraction = document.getElementById('progress-fraction');
  const cancelExportBtn = document.getElementById('cancel-export-btn');

  let currentUser = null;
  let activeEventSource = null;

  // 1. Remember credentials on load
  const savedSchoolNumber = localStorage.getItem('sph_saved_school_number');
  const savedUsername = localStorage.getItem('sph_saved_username');
  if (savedSchoolNumber) {
    schoolNumberInput.value = savedSchoolNumber;
  }
  if (savedUsername) {
    usernameInput.value = savedUsername;
  }
  if (savedSchoolNumber && savedUsername) {
    passwordInput.focus();
  }

  // 2. Export All or Teacher Bulk Export handler
  function triggerBulkExport({ courseIds = null, teacher = null } = {}) {
    if (!currentUser) {
      alert('Kein aktiver Benutzer gefunden.');
      return;
    }

    const semester = document.getElementById('semester-select').value;
    
    // Reset and show progress modal
    if (progressModalTitle) {
      progressModalTitle.textContent = teacher ? `Sammel-Export (${teacher}) läuft...` : 'Sammel-Export läuft...';
    }
    progressStatus.textContent = 'Vorbereiten...';
    progressStatus.style.color = '';
    progressBarFill.style.width = '0%';
    progressPercentage.textContent = '0%';
    progressFraction.textContent = '0 / 0';
    progressOverlay.classList.remove('hidden');

    let exportUrl = `api/export-all?halb=${semester}&user=${encodeURIComponent(currentUser.username)}&schoolNumber=${encodeURIComponent(currentUser.schoolNumber)}`;
    if (courseIds && courseIds.length > 0) {
      exportUrl += `&courseIds=${encodeURIComponent(courseIds.join(','))}`;
    }
    if (teacher) {
      exportUrl += `&teacher=${encodeURIComponent(teacher)}`;
    }

    if (activeEventSource) {
      activeEventSource.close();
      activeEventSource = null;
    }

    activeEventSource = new EventSource(exportUrl);

    activeEventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'start') {
          progressFraction.textContent = `0 / ${data.total}`;
        } else if (data.type === 'progress') {
          const pct = Math.round((data.current / data.total) * 100);
          progressBarFill.style.width = `${pct}%`;
          progressPercentage.textContent = `${pct}%`;
          progressFraction.textContent = `${data.current} / ${data.total}`;
          progressStatus.textContent = `Exportiere: ${data.courseName}...`;
        } else if (data.type === 'complete') {
          if (activeEventSource) {
            activeEventSource.close();
            activeEventSource = null;
          }
          progressStatus.textContent = 'Export erfolgreich! ZIP wird heruntergeladen.';
          progressBarFill.style.width = '100%';
          progressPercentage.textContent = '100%';
          
          setTimeout(() => {
            progressOverlay.classList.add('hidden');
            window.location.href = data.downloadUrl;
          }, 800);
        } else if (data.type === 'error') {
          handleExportError(data.message);
        }
      } catch (err) {
        handleExportError('Verbindungsfehler oder ungültige Serverantwort.');
      }
    };

    activeEventSource.onerror = () => {
      handleExportError('Verbindung zum Server unterbrochen.');
    };
  }

  exportAllBtn.addEventListener('click', () => {
    triggerBulkExport();
  });

  cancelExportBtn.addEventListener('click', () => {
    cleanupExport();
  });

  function handleExportError(msg) {
    if (activeEventSource) {
      activeEventSource.close();
      activeEventSource = null;
    }
    progressStatus.textContent = msg;
    progressStatus.style.color = 'var(--error)';
  }

  function cleanupExport() {
    if (activeEventSource) {
      activeEventSource.close();
      activeEventSource = null;
    }
    progressOverlay.classList.add('hidden');
    progressStatus.style.color = '';
  }

  // Toggle Password Visibility
  togglePasswordBtn.addEventListener('click', () => {
    const isPassword = passwordInput.getAttribute('type') === 'password';
    passwordInput.setAttribute('type', isPassword ? 'text' : 'password');
    
    if (isPassword) {
      togglePasswordBtn.innerHTML = `
        <svg class="eye-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 19c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
          <line x1="1" y1="1" x2="23" y2="23"></line>
        </svg>
      `;
    } else {
      togglePasswordBtn.innerHTML = `
        <svg class="eye-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
          <circle cx="12" cy="12" r="3"></circle>
        </svg>
      `;
    }
  });

  // Handle Form Submit
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideStatus();

    const schoolNumber = schoolNumberInput.value.trim();
    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (!schoolNumber || !username || !password) {
      showError('Bitte füllen Sie alle Felder aus.');
      return;
    }

    // Save remembered credentials in localStorage
    localStorage.setItem('sph_saved_school_number', schoolNumber);
    localStorage.setItem('sph_saved_username', username);

    setLoading(true);

    const timezone = -new Date().getTimezoneOffset() / 60;

    try {
      const response = await fetch('api/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          schoolNumber,
          username,
          password,
          timezone
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Login fehlgeschlagen.');
      }

      showSuccessCard(data.user, data.courses);
    } catch (err) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  });

  // Handle Disconnect
  disconnectBtn.addEventListener('click', () => {
    passwordInput.value = '';

    // Keep remembered credentials prefilled
    const sn = localStorage.getItem('sph_saved_school_number');
    const un = localStorage.getItem('sph_saved_username');
    if (sn) schoolNumberInput.value = sn;
    if (un) usernameInput.value = un;
    
    successCard.classList.add('hidden');
    loginCard.classList.remove('hidden');
    
    coursesContainer.classList.add('hidden');
    if (teachersAccordion) teachersAccordion.innerHTML = '';
    
    hideStatus();
  });

  function setLoading(isLoading) {
    if (isLoading) {
      submitBtn.disabled = true;
      btnText.classList.add('hidden');
      btnLoader.classList.remove('hidden');
    } else {
      submitBtn.disabled = false;
      btnText.classList.remove('hidden');
      btnLoader.classList.add('hidden');
    }
  }

  function showError(msg) {
    statusText.textContent = msg;
    statusMessage.className = 'status-message error';
    statusMessage.classList.remove('hidden');
  }

  function hideStatus() {
    statusMessage.classList.add('hidden');
    statusText.textContent = '';
  }

  function showSuccessCard(user, courses) {
    currentUser = user;
    connectedUserSpan.textContent = `${user.username} (Schule: ${user.schoolNumber})`;

    teachersAccordion.innerHTML = '';

    if (courses && courses.length > 0) {
      const totalCount = courses.length;
      totalCoursesBadge.textContent = `Gesamt: ${totalCount} ${totalCount === 1 ? 'Mappe' : 'Mappen'}`;

      // Group courses by teacher
      const teacherMap = new Map();
      courses.forEach(c => {
        const teacher = c.teacher || 'Ohne Zuordnung';
        if (!teacherMap.has(teacher)) {
          teacherMap.set(teacher, []);
        }
        teacherMap.get(teacher).push(c);
      });

      // Sort teachers alphabetically by Nachname
      const sortedTeachers = Array.from(teacherMap.keys()).sort((a, b) => {
        const lastA = a.includes(',') ? a.split(',')[0].trim() : a.trim();
        const lastB = b.includes(',') ? b.split(',')[0].trim() : b.trim();
        return lastA.localeCompare(lastB, 'de', { sensitivity: 'base' });
      });

      sortedTeachers.forEach((teacherName) => {
        const teacherCourses = teacherMap.get(teacherName);
        teacherCourses.sort((a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }));

        const card = document.createElement('div');
        card.className = 'teacher-group-card expanded';

        // Header
        const header = document.createElement('div');
        header.className = 'teacher-group-header';

        const infoDiv = document.createElement('div');
        infoDiv.className = 'teacher-info';

        const chevron = document.createElement('span');
        chevron.className = 'chevron-icon';
        chevron.innerHTML = `
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        `;

        const nameSpan = document.createElement('span');
        nameSpan.className = 'teacher-name';
        nameSpan.textContent = teacherName;

        const countBadge = document.createElement('span');
        countBadge.className = 'teacher-count-badge';
        countBadge.textContent = `(${teacherCourses.length})`;

        infoDiv.appendChild(chevron);
        infoDiv.appendChild(nameSpan);
        infoDiv.appendChild(countBadge);

        // Teacher Actions
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'teacher-actions';

        const teacherDlBtn = document.createElement('button');
        teacherDlBtn.className = 'teacher-download-btn';
        teacherDlBtn.title = `Alle ${teacherCourses.length} Mappen von ${teacherName} exportieren`;
        teacherDlBtn.innerHTML = `
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          Mappen exportieren
        `;
        teacherDlBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          triggerBulkExport({
            courseIds: teacherCourses.map(c => c.id),
            teacher: teacherName
          });
        });

        actionsDiv.appendChild(teacherDlBtn);
        header.appendChild(infoDiv);
        header.appendChild(actionsDiv);

        // Click on header toggles accordion
        header.addEventListener('click', () => {
          card.classList.toggle('expanded');
        });

        // Panel
        const panel = document.createElement('div');
        panel.className = 'teacher-courses-panel';

        const tableWrapper = document.createElement('div');
        tableWrapper.className = 'table-wrapper';

        const table = document.createElement('table');
        table.className = 'courses-table';
        table.innerHTML = `
          <thead>
            <tr>
              <th style="width: 80px;">Kurs-ID</th>
              <th>Kursname</th>
              <th style="text-align: right; width: 80px;">Aktion</th>
            </tr>
          </thead>
          <tbody></tbody>
        `;
        const tbody = table.querySelector('tbody');

        teacherCourses.forEach(c => {
          const tr = document.createElement('tr');

          const tdId = document.createElement('td');
          tdId.textContent = c.id;

          const tdName = document.createElement('td');
          tdName.textContent = c.name;

          const tdAction = document.createElement('td');
          tdAction.style.textAlign = 'right';

          const downloadBtn = document.createElement('button');
          downloadBtn.className = 'action-icon-btn';
          downloadBtn.title = 'Kurs archivieren';
          downloadBtn.innerHTML = `
            <svg class="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
          `;
          downloadBtn.addEventListener('click', () => {
            const semester = document.getElementById('semester-select').value;
            const downloadUrl = `api/download?id=${c.id}&halb=${semester}&user=${encodeURIComponent(user.username)}&schoolNumber=${encodeURIComponent(user.schoolNumber)}`;
            window.location.href = downloadUrl;
          });

          tdAction.appendChild(downloadBtn);
          tr.appendChild(tdId);
          tr.appendChild(tdName);
          tr.appendChild(tdAction);
          tbody.appendChild(tr);
        });

        tableWrapper.appendChild(table);
        panel.appendChild(tableWrapper);

        card.appendChild(header);
        card.appendChild(panel);
        teachersAccordion.appendChild(card);
      });

      coursesContainer.classList.remove('hidden');
    } else {
      totalCoursesBadge.textContent = 'Gesamt: 0 Mappen';
      teachersAccordion.innerHTML = '<p style="text-align:center; padding: 20px; color: var(--text-muted);">Keine Kurse gefunden.</p>';
      coursesContainer.classList.remove('hidden');
    }

    loginCard.classList.add('hidden');
    successCard.classList.remove('hidden');
  }
});
