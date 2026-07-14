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
  const coursesTbody = document.getElementById('courses-tbody');
  const exportAllBtn = document.getElementById('export-all-btn');
  const progressOverlay = document.getElementById('progress-overlay');
  const progressStatus = document.getElementById('progress-status');
  const progressBarFill = document.getElementById('progress-bar-fill');
  const progressPercentage = document.getElementById('progress-percentage');
  const progressFraction = document.getElementById('progress-fraction');
  const cancelExportBtn = document.getElementById('cancel-export-btn');

  let currentUser = null;
  let activeEventSource = null;

  // Export All click handler
  exportAllBtn.addEventListener('click', () => {
    if (!currentUser) {
      alert('Kein aktiver Benutzer gefunden.');
      return;
    }

    const semester = document.getElementById('semester-select').value;
    
    // Reset and show progress modal
    progressStatus.textContent = 'Vorbereiten...';
    progressStatus.style.color = '';
    progressBarFill.style.width = '0%';
    progressPercentage.textContent = '0%';
    progressFraction.textContent = '0 / 0';
    progressOverlay.classList.remove('hidden');

    const exportUrl = `api/export-all?halb=${semester}&user=${encodeURIComponent(currentUser.username)}&schoolNumber=${encodeURIComponent(currentUser.schoolNumber)}`;
    
    // Establish Server-Sent Events connection
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
            // Trigger automatic file download
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
    
    // Update SVG icon representation if necessary
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

    // Client-side Validation
    const schoolNumber = schoolNumberInput.value.trim();
    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (!schoolNumber || !username || !password) {
      showError('Bitte füllen Sie alle Felder aus.');
      return;
    }

    // Enter loading state
    setLoading(true);

    // Calculate timezone offset (in hours)
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

      // Success
      showSuccessCard(data.user, data.courses);
    } catch (err) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  });

  // Handle Disconnect
  disconnectBtn.addEventListener('click', () => {
    // Reset form fields
    passwordInput.value = '';
    
    // Switch panels
    successCard.classList.add('hidden');
    loginCard.classList.remove('hidden');
    
    coursesContainer.classList.add('hidden');
    coursesTbody.innerHTML = '';
    
    hideStatus();
  });

  // UI State Helper Functions
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
    
    // Clear and build table rows
    coursesTbody.innerHTML = '';
    if (courses && courses.length > 0) {
      courses.forEach(c => {
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
        coursesTbody.appendChild(tr);
      });
      coursesContainer.classList.remove('hidden');
    } else {
      coursesContainer.classList.add('hidden');
    }

    loginCard.classList.add('hidden');
    successCard.classList.remove('hidden');
  }
});
