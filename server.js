const express = require('express');
const axios = require('axios');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const CryptoJS = require('crypto-js');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

// Ensure .env exists and has ENCRYPTION_KEY
const envPath = path.join(__dirname, '.env');
let encryptionKey;
if (!fs.existsSync(envPath)) {
  const generatedKey = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(envPath, `ENCRYPTION_KEY=${generatedKey}\nPORT=3000\n`);
  encryptionKey = generatedKey;
  console.log('Generated new ENCRYPTION_KEY in .env');
} else {
  require('dotenv').config();
  encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey) {
    encryptionKey = crypto.randomBytes(32).toString('hex');
    fs.appendFileSync(envPath, `\nENCRYPTION_KEY=${encryptionKey}\n`);
    console.log('Appended new ENCRYPTION_KEY to .env');
  }
}

const PORT = process.env.PORT || 3012;
const app = express();

let APP_URL = process.env.APP_URL || '/';
if (!APP_URL.startsWith('/')) APP_URL = '/' + APP_URL;
if (!APP_URL.endsWith('/')) APP_URL = APP_URL + '/';

app.use(express.json());

const router = express.Router();
router.use(express.static(path.join(__dirname, 'public')));

// Database Setup
const dbPath = path.join(__dirname, 'database.db');
const db = new Database(dbPath);

// Create table if it doesn't exist
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_number TEXT NOT NULL,
    username TEXT NOT NULL,
    encrypted_password TEXT NOT NULL,
    iv TEXT NOT NULL,
    auth_tag TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(school_number, username)
  );
`);

/**
 * Encrypts cleartext using AES-256-GCM
 */
function encrypt(text) {
  const iv = crypto.randomBytes(12); // 12 bytes IV is standard for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(encryptionKey, 'hex'), iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag().toString('hex');
  
  return {
    encryptedText: encrypted,
    iv: iv.toString('hex'),
    authTag: authTag
  };
}

/**
 * Decrypts ciphertext using AES-256-GCM
 */
function decrypt(encryptedText, ivHex, authTagHex) {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    Buffer.from(encryptionKey, 'hex'),
    Buffer.from(ivHex, 'hex')
  );
  
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

/**
 * Schulportal username logic helper
 */
function processSphUsername(username, schoolNumber) {
  let user = '';
  let user2 = '';

  if (username.includes('.')) {
    // Fall A: Contains a dot
    user = username;
    // user2 is the part after the first dot
    const dotIndex = username.indexOf('.');
    user2 = username.substring(dotIndex + 1);
  } else {
    // Fall B: No dot (e.g. shorthand initials / school identifier)
    user = `${schoolNumber}.${username}`;
    user2 = username;
  }

  return { user, user2 };
}

/**
 * Extracts course IDs and names from meinunterricht.php HTML
 */
function extractCourses(html) {
  const courses = [];
  // Matches href="meinunterricht.php?a=view&amp;id=157" or similar and gets name in the link
  const regex = /href="meinunterricht\.php\?a=view(?:&amp;|&)id=(\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const cleanName = match[2].replace(/<[^>]*>/g, '').trim();
    courses.push({
      id: match[1],
      name: cleanName
    });
  }
  // De-duplicate courses by ID
  return courses.filter((v, i, a) => a.findIndex(t => t.id === v.id) === i);
}

/**
 * Decrypts all <encoded> tags in the HTML using the negotiated AES key
 */
function decryptHtmlEncodedTags(html, aesKey) {
  return html.replace(/<encoded[^>]*>([\s\S]*?)<\/encoded>/gi, (match, ciphertext) => {
    const trimmedCiphertext = ciphertext.trim();
    if (trimmedCiphertext.length === 0) return '';
    try {
      const bytes = CryptoJS.AES.decrypt(trimmedCiphertext, aesKey);
      const plaintext = bytes.toString(CryptoJS.enc.Utf8);
      return plaintext || '';
    } catch (e) {
      console.error('Error decrypting individual SPH tag:', e.message);
      return '';
    }
  });
}

// In-memory cookie jar mock or session store for simplicity
// In the future, this can be expanded to store session states in the database
const sessionStore = new Map();

/**
 * API Endpoint: Login / Authenticate
 */
router.post('/api/login', async (req, res) => {
  const { username, password, schoolNumber, timezone } = req.body;

  if (!username || !password || !schoolNumber) {
    return res.status(400).json({ error: 'Bitte füllen Sie alle Felder aus (Benutzername, Passwort, Schulnummer).' });
  }

  const tz = timezone !== undefined ? timezone : -new Date().getTimezoneOffset() / 60;
  const { user, user2 } = processSphUsername(username.trim(), schoolNumber.trim());

  const targetUrl = 'https://login.schulportal.hessen.de/?url=aHR0cHM6Ly9jb25uZWN0LnNjaHVscG9ydGFsLmhlc3Nlbi5kZS8=&skin=sp&i=' + encodeURIComponent(schoolNumber.trim());

  try {
    const params = new URLSearchParams();
    params.append('url', 'aHR0cHM6Ly9jb25uZWN0LnNjaHVscG9ydGFsLmhlc3Nlbi5kZS8=');
    params.append('timezone', tz.toString());
    params.append('skin', 'sp');
    params.append('user', user);
    params.append('user2', user2);
    params.append('password', password);

    // Perform SPH login POST
    // We disable automatic redirect follow (maxRedirects: 0) to capture the 302 redirect and SPH cookies
    const response = await axios.post(targetUrl, params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400
    });

    const cookies = response.headers['set-cookie'] || [];
    const location = response.headers['location'] || '';

    console.log('=== SPH LOGIN ATTEMPT ===');
    console.log(`School Number: "${schoolNumber.trim()}"`);
    console.log(`Username: "${username.trim()}"`);
    console.log(`Processed user: "${user}"`);
    console.log(`Processed user2: "${user2}"`);
    console.log(`Target URL: "${targetUrl}"`);
    console.log(`Response status: ${response.status}`);
    console.log(`Response Location: "${location}"`);
    console.log(`Response Cookies:`, cookies);
    
    // Log response body
    if (response.data) {
      const bodyStr = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
      console.log(`Response Body (first 2000 chars):`, bodyStr.substring(0, 2000));
    } else {
      console.log(`Response Body is empty/undefined`);
    }

    // Check if login is successful.
    // SPH returns JSON on success: {"error":"0","result":1,"id":"..."}
    // It can also redirect to the redirect URL or return standard cookies
    let isSuccess = false;
    if (response.data && typeof response.data === 'object') {
      if (response.data.result === 1 || response.data.error === "0") {
        isSuccess = true;
      }
    } else if (response.data && typeof response.data === 'string') {
      try {
        const parsed = JSON.parse(response.data);
        if (parsed.result === 1 || parsed.error === "0") {
          isSuccess = true;
        }
      } catch (e) {
        // Fallback to HTML/cookie checks
      }
    }

    if (!isSuccess) {
      isSuccess = location.includes('connect.schulportal.hessen.de') || 
                  cookies.some(cookie => cookie.includes('sid=') || cookie.includes('spconnect=') || cookie.includes('PHPSESSID=') || cookie.includes('SPH-Session='));
    }

    console.log(`Login detection result (isSuccess): ${isSuccess}`);

    if (!isSuccess) {
      // If it returned 200, it rendered the form again (which indicates invalid login credentials)
      // If it redirected elsewhere, it might be an error page
      console.log('Login failed (either wrong credentials or unexpected response structure)');
      return res.status(401).json({ error: 'Anmeldung fehlgeschlagen. Bitte überprüfen Sie Ihre Zugangsdaten und die Schulnummer.' });
    }

    // Encrypt the password to save it in our local SQLite database
    const { encryptedText, iv, authTag } = encrypt(password);

    // Save or update user in SQLite
    const upsertStmt = db.prepare(`
      INSERT INTO users (school_number, username, encrypted_password, iv, auth_tag, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(school_number, username) DO UPDATE SET
        encrypted_password = excluded.encrypted_password,
        iv = excluded.iv,
        auth_tag = excluded.auth_tag,
        updated_at = CURRENT_TIMESTAMP
    `);
    
    upsertStmt.run(schoolNumber.trim(), username.trim(), encryptedText, iv, authTag);

    // Cache the session cookies in memory for subsequent automated tasks
    const sessionKey = `${schoolNumber.trim()}_${username.trim()}`;
    let accumulatedCookies = [...cookies.map(c => c.split(';')[0])];

    const getCookieHeader = () => accumulatedCookies.join('; ');

    // 1. Visit connect.schulportal.hessen.de to make sure the session is initialized there and we get all needed cookies
    try {
      console.log('Visiting connect.schulportal.hessen.de...');
      const connectResponse = await axios.get('https://connect.schulportal.hessen.de/', {
        headers: {
          'Cookie': getCookieHeader(),
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        maxRedirects: 5,
        validateStatus: (status) => status >= 200 && status < 400
      });

      if (connectResponse.headers['set-cookie']) {
        const newCookies = connectResponse.headers['set-cookie'].map(c => c.split(';')[0]);
        accumulatedCookies = [...new Set([...accumulatedCookies, ...newCookies])];
      }
    } catch (connectErr) {
      console.error('Error visiting connect portal:', connectErr.message);
    }

    // 2. Fetch the MeinUnterricht page in the background
    let courses = [];
    try {
      console.log('Fetching MeinUnterricht courses...');
      const coursesResponse = await axios.get('https://start.schulportal.hessen.de/meinunterricht.php?f=allBooks&jump=no', {
        headers: {
          'Cookie': getCookieHeader(),
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        maxRedirects: 5,
        validateStatus: (status) => status >= 200 && status < 400
      });

      if (coursesResponse.headers['set-cookie']) {
        const newCookies = coursesResponse.headers['set-cookie'].map(c => c.split(';')[0]);
        accumulatedCookies = [...new Set([...accumulatedCookies, ...newCookies])];
      }

      if (coursesResponse.data) {
        courses = extractCourses(coursesResponse.data);
        console.log(`Extracted ${courses.length} courses successfully.`);
      }
    } catch (coursesErr) {
      console.error('Error fetching MeinUnterricht page:', coursesErr.message);
    }

    sessionStore.set(sessionKey, {
      cookies: accumulatedCookies,
      loginTime: new Date()
    });

    return res.json({
      success: true,
      message: 'Erfolgreich angemeldet und Kurse geladen.',
      user: {
        schoolNumber: schoolNumber.trim(),
        username: username.trim()
      },
      courses: courses
    });

  } catch (error) {
    console.error('SPH Login Request Error:', error.message);
    return res.status(500).json({ error: `Verbindungsfehler zum Schulportal: ${error.message}` });
  }
});

router.get('/api/download', async (req, res) => {
  const { id, halb, user, schoolNumber } = req.query;

  if (!id || !halb || !user || !schoolNumber) {
    return res.status(400).send('Fehlende Parameter (id, halb, user, schoolNumber).');
  }

  const sessionKey = `${schoolNumber.trim()}_${user.trim()}`;
  const session = sessionStore.get(sessionKey);

  if (!session || !session.cookies) {
    return res.status(401).send('Nicht autorisiert. Bitte melden Sie sich erneut an.');
  }

  let currentCookies = [...session.cookies];
  const getCookieHeader = () => currentCookies.join('; ');

  const updateCookies = (responseObj) => {
    if (responseObj && responseObj.headers && responseObj.headers['set-cookie']) {
      const newCookies = responseObj.headers['set-cookie'].map(c => c.split(';')[0]);
      currentCookies = [...new Set([...currentCookies, ...newCookies])];
      session.cookies = currentCookies;
      sessionStore.set(sessionKey, session);
    }
  };

  try {
    // 1. Fetch the RSA Public Key from SPH
    console.log('Fetching RSA Public Key for PDF download...');
    const pkResponse = await axios.get('https://start.schulportal.hessen.de/ajax.php?f=rsaPublicKey', {
      headers: {
        'Cookie': getCookieHeader(),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    updateCookies(pkResponse);

    const pemKey = pkResponse.data && pkResponse.data.publickey;
    if (!pemKey) {
      throw new Error('RSA Public Key konnte nicht vom Schulportal geladen werden.');
    }

    // 2. Generate a random AES key (32-char hex string)
    const aesKey = crypto.randomBytes(16).toString('hex');
    console.log('Generated AES Key for decryption:', aesKey);

    // 3. Encrypt the AES key with SPH's RSA Public Key
    const encryptedKey = crypto.publicEncrypt({
      key: pemKey,
      padding: crypto.constants.RSA_PKCS1_PADDING
    }, Buffer.from(aesKey)).toString('base64');

    // 4. Perform SPH Handshake to store AES key in SPH session
    console.log('Sending SPH handshake POST...');
    const hsParams = new URLSearchParams();
    hsParams.append('key', encryptedKey);

    const hsResponse = await axios.post('https://start.schulportal.hessen.de/ajax.php?f=rsaHandshake&s=' + Math.floor(Math.random() * 2000), hsParams.toString(), {
      headers: {
        'Cookie': getCookieHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    updateCookies(hsResponse);

    if (!hsResponse.data || !hsResponse.data.challenge) {
      throw new Error('Handshake mit Schulportal fehlgeschlagen.');
    }
    console.log('Handshake successful. Session is unlocked.');

    // 5. Fetch the printDelivery page HTML
    const targetUrl = `https://start.schulportal.hessen.de/meinunterricht.php?a=printDelivery&id=${encodeURIComponent(id)}&halb=${encodeURIComponent(halb)}`;
    console.log(`Downloading print view from: ${targetUrl}`);
    const pageResponse = await axios.get(targetUrl, {
      headers: {
        'Cookie': getCookieHeader(),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    updateCookies(pageResponse);

    if (!pageResponse.data) {
      throw new Error('Keine Daten vom Schulportal erhalten.');
    }

    let html = pageResponse.data;

    // 6. Decrypt all <encoded> tags in the HTML on the server-side
    console.log('Decrypting <encoded> tags in HTML...');
    html = decryptHtmlEncodedTags(html, aesKey);

    // 7. Inject style override to hide encrypted hashes and <base> tag
    const injection = `
      <base href="https://start.schulportal.hessen.de/">
      <style>
        .hidden, .hidden_encoded, encoded {
          display: none !important;
        }
      </style>
    `;
    html = html.replace('<head>', `<head>${injection}`);

    // Detect browser executable on Windows
    const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    const chromePath86 = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
    const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

    let browserPath = '';
    if (fs.existsSync(chromePath)) {
      browserPath = chromePath;
    } else if (fs.existsSync(chromePath86)) {
      browserPath = chromePath86;
    } else if (fs.existsSync(edgePath)) {
      browserPath = edgePath;
    }

    if (!browserPath) {
      throw new Error('Kein geeigneter Browser (Chrome oder Edge) zum PDF-Drucken gefunden.');
    }

    // Create temp files
    const tempId = crypto.randomBytes(8).toString('hex');
    const tempHtmlPath = path.join(__dirname, `temp_${tempId}.html`);
    const tempPdfPath = path.join(__dirname, `temp_${tempId}.pdf`);

    fs.writeFileSync(tempHtmlPath, html, 'utf8');

    const args = [
      '--headless',
      '--disable-gpu',
      '--no-pdf-header-footer',
      `--print-to-pdf=${tempPdfPath}`,
      tempHtmlPath
    ];

    const { execFile } = require('child_process');
    execFile(browserPath, args, (err) => {
      // Clean up HTML file immediately
      try { fs.unlinkSync(tempHtmlPath); } catch (e) {}

      if (err) {
        console.error('PDF creation error:', err.message);
        return res.status(500).send(`Fehler bei der PDF-Erstellung: ${err.message}`);
      }

      if (fs.existsSync(tempPdfPath)) {
        // Send file for download
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="kurs_${id}_halbjahr_${halb}.pdf"`);

        res.sendFile(tempPdfPath, (sendFileErr) => {
          // Clean up PDF file after sending
          try { fs.unlinkSync(tempPdfPath); } catch (e) {}
          if (sendFileErr) {
            console.error('Error sending file:', sendFileErr.message);
          }
        });
      } else {
        res.status(500).send('PDF konnte nicht generiert werden.');
      }
    });

  } catch (err) {
    console.error('Download error:', err.message);
    res.status(500).send(`Verbindungsfehler oder Download-Fehler: ${err.message}`);
  }
});

router.get('/api/export-all', async (req, res) => {
  const { halb, user, schoolNumber } = req.query;

  if (!halb || !user || !schoolNumber) {
    return res.status(400).send('Fehlende Parameter.');
  }

  const sessionKey = `${schoolNumber.trim()}_${user.trim()}`;
  const session = sessionStore.get(sessionKey);

  if (!session || !session.cookies) {
    return res.status(401).send('Nicht autorisiert.');
  }

  // Set headers for Server-Sent Events (SSE)
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders && res.flushHeaders();

  const sendSSE = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  let currentCookies = [...session.cookies];
  const getCookieHeader = () => currentCookies.join('; ');

  const updateCookies = (responseObj) => {
    if (responseObj && responseObj.headers && responseObj.headers['set-cookie']) {
      const newCookies = responseObj.headers['set-cookie'].map(c => c.split(';')[0]);
      currentCookies = [...new Set([...currentCookies, ...newCookies])];
      session.cookies = currentCookies;
      sessionStore.set(sessionKey, session);
    }
  };

  let tempDir = '';
  let zipPath = '';
  let pdfPaths = [];

  try {
    console.log('Fetching courses for bulk export...');
    const coursesResponse = await axios.get('https://start.schulportal.hessen.de/meinunterricht.php?f=allBooks&jump=no', {
      headers: {
        'Cookie': getCookieHeader(),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    updateCookies(coursesResponse);

    const courses = extractCourses(coursesResponse.data);
    if (courses.length === 0) {
      sendSSE({ type: 'error', message: 'Keine Kurse gefunden.' });
      return res.end();
    }

    sendSSE({ type: 'start', total: courses.length });

    const exportId = crypto.randomBytes(8).toString('hex');
    tempDir = path.join(__dirname, `temp_export_${exportId}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    const chromePath86 = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
    const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

    let browserPath = '';
    if (fs.existsSync(chromePath)) browserPath = chromePath;
    else if (fs.existsSync(chromePath86)) browserPath = chromePath86;
    else if (fs.existsSync(edgePath)) browserPath = edgePath;

    if (!browserPath) {
      throw new Error('Kein geeigneter Browser zum PDF-Drucken gefunden.');
    }

    const { execFile } = require('child_process');

    for (let i = 0; i < courses.length; i++) {
      const course = courses[i];
      console.log(`Processing course ${i+1}/${courses.length}: ${course.name} (ID: ${course.id})`);
      sendSSE({ type: 'progress', current: i + 1, total: courses.length, courseName: course.name });

      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }

      const pkResponse = await axios.get('https://start.schulportal.hessen.de/ajax.php?f=rsaPublicKey', {
        headers: {
          'Cookie': getCookieHeader(),
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      updateCookies(pkResponse);

      const pemKey = pkResponse.data && pkResponse.data.publickey;
      if (!pemKey) throw new Error(`RSA Public Key für Kurs ${course.name} konnte nicht geladen werden.`);

      const aesKey = crypto.randomBytes(16).toString('hex');
      const encryptedKey = crypto.publicEncrypt({
        key: pemKey,
        padding: crypto.constants.RSA_PKCS1_PADDING
      }, Buffer.from(aesKey)).toString('base64');

      const hsParams = new URLSearchParams();
      hsParams.append('key', encryptedKey);

      const hsResponse = await axios.post('https://start.schulportal.hessen.de/ajax.php?f=rsaHandshake&s=' + Math.floor(Math.random() * 2000), hsParams.toString(), {
        headers: {
          'Cookie': getCookieHeader(),
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      updateCookies(hsResponse);

      if (!hsResponse.data || !hsResponse.data.challenge) {
        throw new Error(`Handshake für Kurs ${course.name} fehlgeschlagen.`);
      }

      const targetUrl = `https://start.schulportal.hessen.de/meinunterricht.php?a=printDelivery&id=${encodeURIComponent(course.id)}&halb=${encodeURIComponent(halb)}`;
      const pageResponse = await axios.get(targetUrl, {
        headers: {
          'Cookie': getCookieHeader(),
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      updateCookies(pageResponse);

      let html = pageResponse.data;
      if (!html) throw new Error(`Keine Daten für Kurs ${course.name} erhalten.`);

      html = decryptHtmlEncodedTags(html, aesKey);

      const injection = `
        <base href="https://start.schulportal.hessen.de/">
        <style>
          .hidden, .hidden_encoded, encoded {
            display: none !important;
          }
        </style>
      `;
      html = html.replace('<head>', `<head>${injection}`);

      const tempHtmlPath = path.join(tempDir, `temp_${course.id}.html`);
      const tempPdfPath = path.join(tempDir, `kurs_${course.id}.pdf`);
      fs.writeFileSync(tempHtmlPath, html, 'utf8');

      const args = [
        '--headless',
        '--disable-gpu',
        '--no-pdf-header-footer',
        `--print-to-pdf=${tempPdfPath}`,
        tempHtmlPath
      ];

      await new Promise((resolve, reject) => {
        execFile(browserPath, args, (err) => {
          try { fs.unlinkSync(tempHtmlPath); } catch (e) {}
          if (err) reject(err);
          else resolve();
        });
      });

      pdfPaths.push({
        path: tempPdfPath,
        name: `${course.name.replace(/[^a-zA-Z0-9_\-]/g, '_')}_halbjahr_${halb}.pdf`
      });
    }

    console.log('Packaging ZIP archive...');
    const zip = new AdmZip();
    pdfPaths.forEach(pdf => {
      if (fs.existsSync(pdf.path)) {
        zip.addLocalFile(pdf.path, '', pdf.name);
      }
    });

    zipPath = path.join(__dirname, `schulportal_export_${exportId}.zip`);
    zip.writeZip(zipPath);
    console.log('ZIP written successfully to:', zipPath);

    const downloadFilename = `schulportal_export_halbjahr_${halb}_${exportId}.zip`;
    sendSSE({
      type: 'complete',
      downloadUrl: `api/download-zip?file=${path.basename(zipPath)}&name=${encodeURIComponent(downloadFilename)}`
    });

  } catch (err) {
    console.error('Bulk export error:', err.message);
    sendSSE({ type: 'error', message: `Export fehlgeschlagen: ${err.message}` });
  } finally {
    if (tempDir && fs.existsSync(tempDir)) {
      try {
        const files = fs.readdirSync(tempDir);
        files.forEach(f => fs.unlinkSync(path.join(tempDir, f)));
        fs.rmdirSync(tempDir);
      } catch (e) {
        console.error('Clean temporary export directory error:', e.message);
      }
    }
    res.end();
  }
});

router.get('/api/download-zip', (req, res) => {
  const { file, name } = req.query;
  if (!file) return res.status(400).send('Fehlender Dateiname.');

  const safeFilename = path.basename(file);
  const filePath = path.join(__dirname, safeFilename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Datei nicht gefunden oder abgelaufen.');
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${name || safeFilename}"`);

  res.sendFile(filePath, (err) => {
    try { fs.unlinkSync(filePath); } catch (e) {}
    if (err) {
      console.error('Error sending ZIP file:', err.message);
    }
  });
});

// Mount the router on APP_URL
app.use(APP_URL, router);

if (APP_URL !== '/') {
  const urlWithoutTrailing = APP_URL.slice(0, -1);
  app.get(urlWithoutTrailing, (req, res) => {
    res.redirect(APP_URL);
  });
  app.get('/', (req, res) => {
    res.redirect(APP_URL);
  });
}

// Start Server
app.listen(PORT, () => {
  console.log(`Server läuft auf http://localhost:${PORT}`);

  // Clean up any leftover temp files or zip files from previous runs
  try {
    const files = fs.readdirSync(__dirname);
    files.forEach(file => {
      if (file.startsWith('temp_') || (file.startsWith('schulportal_export_') && file.endsWith('.zip'))) {
        const filePath = path.join(__dirname, file);
        try {
          const stats = fs.statSync(filePath);
          if (stats.isDirectory()) {
            const subfiles = fs.readdirSync(filePath);
            subfiles.forEach(sf => fs.unlinkSync(path.join(filePath, sf)));
            fs.rmdirSync(filePath);
            console.log(`Cleaned up leftover directory: ${file}`);
          } else {
            fs.unlinkSync(filePath);
            console.log(`Cleaned up leftover file: ${file}`);
          }
        } catch (err) {
          console.error(`Error deleting leftover ${file}:`, err.message);
        }
      }
    });
  } catch (err) {
    console.error('Error during startup cleanup:', err.message);
  }
});
