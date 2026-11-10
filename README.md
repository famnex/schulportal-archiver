# Schulportal Hessen Archiver

This web application integrates with the Schulportal Hessen (SPH) to perform a login with a user's credentials (username, password, and school number) and securely store them. This application lays the groundwork for further automated processes (such as archiving).

## Architecture

The project consists of:
1. **Frontend (SPA)**: A premium web interface built using HTML, modern CSS, and JavaScript.
2. **Backend (Express)**: Serves the web interface, exposes API endpoints, manages session data, communicates with SPH, and encrypts/stores credentials.
3. **Database (SQLite)**: Stores credentials securely.

## Security Features

- **AES-256-GCM Encryption**: Credentials (specifically SPH passwords) are stored in SQLite encrypted via AES-256-GCM. We generate a unique Initialization Vector (IV) for each encryption and save it alongside the ciphertext and the integrity verification authentication tag (`auth_tag`).
- **Dynamic Key Generation**: On first launch, a cryptographically secure random key is generated and saved in `.env` under `ENCRYPTION_KEY`. This file is ignored by Git.

## How to Run

1. Make sure Node.js and a Chromium/Chrome browser are installed:
   - **Linux (Debian/Ubuntu)**:
     ```bash
     sudo apt update ; sudo apt install -y chromium-browser # oder chromium
     ```
   - **Windows / macOS**: Standard Google Chrome or Microsoft Edge.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the application:
   - **Development**:
     ```bash
     npm start
     ```
   - **Production (PM2 with Subpath)**:
     ```bash
     PORT=3012 APP_URL="/it/schulportal-archiver/" pm2 start server.js --name "schulportal-archiver"
     ```
4. Access the application at your configured port/URL.

## Directory Structure

- `server.js` - Main backend logic, database setup, encryption utilities, and API endpoints.
- `db.md` - Database schema documentation.
- `public/` - Static assets served to the client:
  - `index.html` - Main user interface structure.
  - `style.css` - UI layout and styling (premium dark mode design).
  - `app.js` - Client-side state handling and login API communication.
- `database.db` - SQLite database containing stored credentials.
